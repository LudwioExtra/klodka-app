/* Vision worker: runs the image encoder (CLIP ViT-B/32, int8) with onnxruntime-web, off the main thread.
   Messages in:  {type:"init", threads} | {type:"embed", id, n, pixels:Float32Array(n*3*224*224)}
   Messages out: {type:"progress", loaded, total} | {type:"ready", threads, ms, version}
                 | {type:"embeds", id, data:Float32Array(n*D), ms} | {type:"error", id?, message, threads?}
   The model and the runtime are stored in the Cache API by this worker itself, so the app works offline
   from the first visit on. Privacy: every pixel buffer received is overwritten with zeros right after use. */
import * as ort from "./ort/ort.wasm.bundle.min.mjs";

const CACHE = "klodka-model-b32-int8-1"; // keep in sync with MODEL in sw.js and app.js
const base = new URL("./", self.location.href).href;
let session = null, manifest = null, busy = Promise.resolve(), initPromise = null;

async function openCache() { try { return await caches.open(CACHE); } catch (e) { return null; } }

async function getManifest(cache) {
  const url = base + "model/model.json";
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
    return await res.json();
  } catch (e) {
    const hit = cache && (await cache.match(url));
    if (hit) return hit.json();
    throw e;
  }
}

async function sha256hex(view) {
  if (!self.crypto || !crypto.subtle) return null;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", view));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

// One file from the cache, copied into `target`. Returns false when it is missing or the wrong size.
async function fromCache(cache, url, target, onBytes) {
  if (!cache) return false;
  const hit = await cache.match(url);
  if (!hit) return false;
  const buf = new Uint8Array(await hit.arrayBuffer());
  if (buf.length !== target.length) { await cache.delete(url); return false; }
  target.set(buf);
  onBytes(target.length);
  return true;
}

// One file streamed from the network straight into `target`, checked (size, sha256) and cached.
async function download(cache, url, target, sha, onBytes) {
  const bytes = target.length;
  for (let attempt = 0; ; attempt++) {
    let got = 0;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (got + value.length > bytes) throw new Error("size");
          target.set(value, got);
          got += value.length;
          onBytes(value.length);
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > bytes) throw new Error("size");
        target.set(buf);
        got = buf.length;
        onBytes(got);
      }
      if (got !== bytes) throw new Error("size");
      if (sha) {
        const h = await sha256hex(target);
        if (h && h !== sha) throw new Error("checksum");
      }
      if (cache) await cache.put(url, new Response(target, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
      return;
    } catch (e) {
      onBytes(-got);
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

async function dropCached(cache) {
  if (!cache || !manifest) return;
  await Promise.all(manifest.parts.map((p) => cache.delete(base + "model/" + p.file)));
  if (manifest.runtime) await cache.delete(base + "ort/" + manifest.runtime.file);
}

async function init(threads) {
  const t0 = performance.now();
  const cache = await openCache();
  manifest = await getManifest(cache);
  const rt = manifest.runtime || { file: "ort-wasm-simd-threaded.wasm", bytes: 0 };
  const total = manifest.bytes + (rt.bytes || 0);
  let loaded = 0, lastPost = 0;
  const onBytes = (n) => {
    loaded += n;
    const now = performance.now();
    if (now - lastPost > 150 || loaded >= total) { lastPost = now; postMessage({ type: "progress", loaded, total }); }
  };
  let model = new Uint8Array(manifest.bytes);
  let wasm;
  if (rt.bytes) {
    wasm = new Uint8Array(rt.bytes);
  } else {
    const r = await fetch(base + "ort/" + rt.file);
    wasm = new Uint8Array(await r.arrayBuffer());
  }
  const jobs = [];
  if (rt.bytes) jobs.push({ url: base + "ort/" + rt.file, target: wasm, sha: null });
  let off = 0;
  for (const p of manifest.parts) {
    jobs.push({ url: base + "model/" + p.file, target: model.subarray(off, off + p.bytes), sha: p.sha256 });
    off += p.bytes;
  }
  // Cached files one by one (low peak memory), then the missing ones downloaded in parallel.
  const missing = [];
  for (const j of jobs) if (!(await fromCache(cache, j.url, j.target, onBytes))) missing.push(j);
  await Promise.all(missing.map((j) => download(cache, j.url, j.target, j.sha, onBytes)));
  const fromCacheOnly = missing.length === 0;

  ort.env.logLevel = "error";
  ort.env.wasm.wasmBinary = wasm;
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.initTimeout = 20000;
  try {
    session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    model = null; // ORT keeps its own copy
    const size = manifest.input.size;
    await session.run({ [manifest.input.name]: new ort.Tensor("float32", new Float32Array(3 * size * size), [1, 3, size, size]) });
  } catch (e) {
    session = null;
    // A damaged cached copy would fail forever — drop it so the next attempt downloads a fresh one.
    if (fromCacheOnly) await dropCached(cache);
    throw e;
  }
  postMessage({ type: "ready", threads, ms: Math.round(performance.now() - t0), version: manifest.version });
}

async function embed(msg) {
  const size = manifest.input.size;
  const pixels = msg.pixels;
  const t0 = performance.now();
  try {
    const res = await session.run({ [manifest.input.name]: new ort.Tensor("float32", pixels, [msg.n, 3, size, size]) });
    const out = res[manifest.output].data;
    const data = new Float32Array(out.length);
    data.set(out);
    postMessage({ type: "embeds", id: msg.id, data, ms: Math.round(performance.now() - t0) }, [data.buffer]);
  } finally {
    pixels.fill(0); // wipe the photo pixels
  }
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === "init") {
    if (!initPromise) {
      const threads = Math.max(1, msg.threads | 0 || 1);
      initPromise = init(threads).catch((e) => {
        initPromise = null;
        postMessage({ type: "error", message: String((e && e.message) || e), threads });
        throw e;
      });
      initPromise.catch(() => {});
    }
    return;
  }
  if (msg.type === "embed") {
    busy = busy.then(async () => {
      try {
        if (!session) {
          if (!initPromise) throw new Error("model");
          await initPromise;
        }
        await embed(msg);
      } catch (e) {
        if (msg.pixels) msg.pixels.fill(0);
        postMessage({ type: "error", id: msg.id, message: String((e && e.message) || e) });
      }
    });
  }
};
