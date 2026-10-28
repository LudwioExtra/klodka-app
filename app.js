/* „Jaka to kłódka?” — rozpoznawanie kłódek na telefonie.
   Przepływ: aparat w aplikacji → 3 kadry 224×224 → model obrazu w workerze → głowice zero-shot
   → łączenie dowodów (typ, marka, otwór, klucz, poprawki) → mechanizm z pewnością → ocena odporności.
   Prywatność: żaden plik zdjęcia nie powstaje; piksele są zerowane po użyciu, historia trzyma tylko tekst. */
(() => {
  "use strict";
  const KB = window.KB;
  const $ = (id) => document.getElementById(id);

  /* ======================= Helpers ======================= */

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v; // static, trusted markup only (icons from kb.js)
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const icon = (paths, vb) => '<svg viewBox="' + (vb || "0 0 48 48") + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  const pct = (p) => Math.round(p * 100) + "%";
  const uniq = (arr) => arr.filter((x, i) => x && arr.indexOf(x) === i);
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const dtf = (() => { try { return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return null; } })();
  const fmtDate = (ts) => (dtf ? dtf.format(new Date(ts)) : new Date(ts).toLocaleString());
  const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  function plural(n, one, few, many) {
    n = Math.abs(Math.floor(n));
    if (n === 1) return one;
    const d = n % 10, dd = n % 100;
    return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
  }
  const toneOf = (v) => (v <= 2 ? "bad" : v === 3 ? "warn" : "good");
  const confTone = (p) => (p >= 0.85 ? "good" : p >= 0.6 ? "warn" : "bad");
  const confWord = (p) => (p >= 0.85 ? "pewne" : p >= 0.6 ? "prawdopodobne" : "niepewne");

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    size(k) { try { const v = localStorage.getItem(k); return v ? v.length : 0; } catch (e) { return 0; } }
  };

  let toastTimer = null;
  function toast(text, ms) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  /* ======================= Model (worker) ======================= */

  const Model = (() => {
    let worker = null, seq = 0, classes = null, index = null, manifest = null;
    const waiting = new Map();
    const st = { state: "idle", loaded: 0, total: 0, threads: 1, error: null };
    const listeners = new Set();
    const emit = () => listeners.forEach((fn) => { try { fn(st); } catch (e) { /* ignore */ } });

    function f16(u16) {
      const out = new Float32Array(u16.length);
      for (let i = 0; i < u16.length; i++) {
        const x = u16[i], s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 0x1f, f = x & 0x3ff;
        out[i] = e === 0 ? s * 5.960464477539063e-8 * f : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024);
      }
      return out;
    }
    let classesLoading = null;
    function loadClasses() {
      if (classes) return Promise.resolve();
      if (!classesLoading) {
        classesLoading = (async () => {
          // Same cache as the vision worker, filled directly so offline use works from the first visit.
          let cache = null;
          try { cache = await caches.open("klodka-model-b32-int8-1"); } catch (e) { cache = null; }
          const grab = async (url, fresh) => {
            if (cache && !fresh) { const hit = await cache.match(url); if (hit) return hit; }
            try {
              const r = await fetch(url, fresh ? { cache: "no-cache" } : undefined);
              if (!r.ok) throw new Error(url);
              if (cache) await cache.put(url, r.clone()).catch(() => {});
              return r;
            } catch (e) {
              const hit = cache && (await cache.match(url));
              if (hit) return hit;
              throw e;
            }
          };
          const m = await (await grab(new URL("model/model.json", location.href).href, true)).json();
          const bin = await (await grab(new URL("model/" + m.classes.file, location.href).href, false)).arrayBuffer();
          const C = f16(new Uint16Array(bin));
          const idx = m.index;
          if (!idx || C.length !== idx.rows * idx.dim) throw new Error("classes size");
          manifest = m; index = idx; classes = C;
        })();
        classesLoading.catch(() => { classesLoading = null; });
      }
      return classesLoading;
    }
    let attempts = 0;
    function start(threadsOverride) {
      if (worker || st.state === "ready") return;
      st.state = "loading"; st.error = null; emit();
      loadClasses().catch((e) => fail(e));
      try {
        worker = new Worker("vision-worker.js", { type: "module" });
      } catch (e) { fail(e); return; }
      const cores = navigator.hardwareConcurrency || 1;
      const threads = threadsOverride || (self.crossOriginIsolated === true && cores > 1 ? Math.min(4, cores) : 1);
      attempts++;
      worker.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === "progress") { st.loaded = m.loaded; st.total = m.total; emit(); }
        else if (m.type === "ready") { st.threads = m.threads; st.ms = m.ms; loadClasses().then(() => { st.state = "ready"; emit(); }, fail); }
        else if (m.type === "embeds") { const p = waiting.get(m.id); if (p) { waiting.delete(m.id); p.resolve(m.data); } }
        else if (m.type === "error") {
          if (m.id != null) { const p = waiting.get(m.id); if (p) { waiting.delete(m.id); p.reject(new Error(m.message)); } }
          else if (attempts < 3) {
            // Retry once more, single-threaded (also re-downloads a damaged cached copy).
            try { worker.terminate(); } catch (x) { /* ignore */ }
            worker = null;
            const pend = Array.from(waiting.values());
            waiting.clear();
            pend.forEach((p) => p.reject(new Error("model")));
            st.state = "idle";
            start(1);
          } else fail(new Error(m.message));
        }
      };
      worker.onerror = (e) => { e.preventDefault && e.preventDefault(); fail(new Error((e && e.message) || "worker")); };
      worker.postMessage({ type: "init", threads });
    }
    function fail(e) {
      st.state = "error"; st.error = String((e && e.message) || e); emit();
      waiting.forEach((p) => p.reject(new Error("model")));
      waiting.clear();
      if (worker) { try { worker.terminate(); } catch (x) { /* ignore */ } worker = null; }
    }
    function embed(pixels, n) {
      if (st.state === "error") { pixels.fill(0); return Promise.reject(new Error("model")); }
      if (!worker) start();
      return new Promise((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, { resolve, reject });
        // Transfer the buffer: the main thread keeps no copy of the pixels; the worker zeroes it after use.
        worker.postMessage({ type: "embed", id, n, pixels }, [pixels.buffer]);
      });
    }
    function retry() { if (st.state === "error") { st.state = "idle"; attempts = 0; start(); } }
    return { start, embed, retry, st, on: (fn) => listeners.add(fn), get classes() { return classes; }, get index() { return index; }, get manifest() { return manifest; }, loadClasses };
  })();

  /* ======================= Zero-shot heads ======================= */

  const SCALE = 100;
  // Zero-shot class probabilities; `bias` (mean probability over 1000 varied photos) is divided out
  // so a head does not lean towards some answers regardless of the photo.
  function headProbs(sims, H, bias, gamma) {
    const n = H.modes.length, z = new Float64Array(n);
    let mx = -Infinity;
    for (let k = 0; k < n; k++) { z[k] = SCALE * sims[H.start + k]; if (z[k] > mx) mx = z[k]; }
    let s = 0;
    for (let k = 0; k < n; k++) { z[k] = Math.exp(z[k] - mx); s += z[k]; }
    const p = {};
    H.classes.forEach((c) => { p[c] = 0; });
    for (let k = 0; k < n; k++) p[H.classes[H.modes[k]]] += z[k] / s;
    if (bias && bias.length === H.classes.length) {
      let t = 0;
      H.classes.forEach((c, i) => { p[c] /= Math.pow(Math.max(bias[i], 1e-4), gamma); t += p[c]; });
      H.classes.forEach((c) => { p[c] /= t; });
    }
    return p;
  }
  function scoreEmbedding(e) {
    const C = Model.classes, idx = Model.index, R = idx.rows, D = idx.dim;
    const sims = new Float32Array(R);
    for (let r = 0; r < R; r++) { let s = 0; const o = r * D; for (let d = 0; d < D; d++) s += C[o + d] * e[d]; sims[r] = s; }
    const Hv = idx.heads.view, N0 = idx.negative.start, NC = idx.negative.count;
    // Gate: view modes + negative bank in one softmax.
    const nv = Hv.modes.length, z = new Float64Array(nv + NC);
    let mx = -Infinity;
    for (let k = 0; k < nv; k++) { z[k] = SCALE * sims[Hv.start + k]; mx = Math.max(mx, z[k]); }
    for (let k = 0; k < NC; k++) { z[nv + k] = SCALE * sims[N0 + k]; mx = Math.max(mx, z[nv + k]); }
    let s = 0;
    for (let k = 0; k < z.length; k++) { z[k] = Math.exp(z[k] - mx); s += z[k]; }
    const gate = { nic: 0 };
    Hv.classes.forEach((c) => { gate[c] = 0; });
    for (let k = 0; k < nv; k++) gate[Hv.classes[Hv.modes[k]]] += z[k] / s;
    for (let k = 0; k < NC; k++) gate.nic += z[nv + k] / s;
    const Hb = idx.heads.brand, bs = [];
    for (let k = 0; k < Hb.modes.length; k++) bs.push([Hb.classes[Hb.modes[k]], sims[Hb.start + k]]);
    bs.sort((a, b) => b[1] - a[1]);
    const B = idx.bias || {}, g = idx.gamma || 0.7;
    return {
      gate,
      typ: headProbs(sims, idx.heads.typ, B.typ, g),
      material: headProbs(sims, idx.heads.material, B.material, g),
      brand: headProbs(sims, Hb, B.brand, g),
      brandTop: bs[0][0], brandMargin: bs[0][1] - bs[1][1],
      keyway: headProbs(sims, idx.heads.keyway, B.keyway, g),
      key: headProbs(sims, idx.heads.key, B.key, g)
    };
  }
  function viewWeights(g) {
    return { front: g.klodka + 0.5 * g.inny_zamek + 0.35 * g.nic, keyway: g.otwor, key: g.klucz };
  }
  function viewKind(w) {
    if (w.key >= w.front && w.key >= w.keyway) return "key";
    if (w.keyway >= w.front) return "keyway";
    return "front";
  }

  /* ======================= Learning from corrections (embeddings only) ======================= */

  const LKEY = "jaka-to-klodka/nauka/v1", SKEY = "jaka-to-klodka/ustawienia/v1";
  const settings = Object.assign({ learn: true, auto: true }, store.get(SKEY, {}));
  const b64 = {
    enc(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
    dec(str) { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  };
  function toF16(f32) {
    const out = new Uint16Array(f32.length), fv = new Float32Array(1), iv = new Uint32Array(fv.buffer);
    for (let i = 0; i < f32.length; i++) {
      fv[0] = f32[i];
      const x = iv[0], sgn = (x >>> 16) & 0x8000;
      let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
      if (e <= 0) out[i] = sgn;
      else if (e >= 31) out[i] = sgn | 0x7c00;
      else { m += 0x1000; if (m & 0x800000) { m = 0; e++; } out[i] = e >= 31 ? sgn | 0x7c00 : sgn | (e << 10) | (m >> 13); }
    }
    return out;
  }
  function fromF16(u16) {
    const out = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) {
      const x = u16[i], s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 0x1f, f = x & 0x3ff;
      out[i] = e === 0 ? s * 5.960464477539063e-8 * f : e === 31 ? 0 : s * Math.pow(2, e - 15) * (1 + f / 1024);
    }
    return out;
  }
  const Learn = {
    items: [],
    load() {
      const raw = store.get(LKEY, []);
      this.items = Array.isArray(raw) ? raw.filter((x) => x && typeof x.e === "string" && typeof x.l === "string" && ["typ", "mech", "brand"].includes(x.f)).slice(0, 400).map((x) => {
        try { const u = b64.dec(x.e); if (u.length !== 1024) return null; return { f: x.f, l: x.l, v: x.v, ts: x.ts || 0, e: fromF16(new Uint16Array(u.buffer)) }; } catch (e) { return null; }
      }).filter(Boolean) : [];
    },
    save() {
      const out = this.items.slice(0, 400).map((x) => ({ f: x.f, l: x.l, v: x.v, ts: x.ts, e: b64.enc(new Uint8Array(toF16(x.e).buffer)) }));
      let arr = out;
      while (arr.length && !store.set(LKEY, arr)) arr = arr.slice(0, Math.floor(arr.length * 0.7));
    },
    add(field, label, photos) {
      if (!settings.learn || !photos.length) return;
      photos.forEach((p) => {
        // A re-correction of the same photo replaces the earlier example.
        this.items = this.items.filter((x) => !(x.f === field && cos(x.e, p.e) > 0.995));
        this.items.unshift({ f: field, l: label, v: p.kind, ts: Date.now(), e: Float32Array.from(p.e) });
      });
      this.items = this.items.slice(0, 400);
      this.save();
    },
    // Similar remembered examples → evidence { label: weight }.
    match(field, p) {
      const out = {};
      if (!settings.learn) return out;
      for (const x of this.items) {
        if (x.f !== field || x.v !== p.kind) continue;
        const s = cos(x.e, p.e);
        if (s < 0.86) continue;
        const w = clamp((s - 0.86) / 0.1, 0, 1);
        out[x.l] = Math.max(out[x.l] || 0, w);
      }
      return out;
    },
    clear() { this.items = []; store.del(LKEY); }
  };
  function cos(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  /* ======================= Evidence fusion ======================= */

  const EPS = 1e-4;
  const TYPE_SHARE = { standard: 0.38, laminowana: 0.2, szyfrowa_kolka: 0.12, oslonieta: 0.08, dyskowa: 0.06, linkowa: 0.04, tsa: 0.05, szyfrowa_tarcza: 0.03, elektroniczna: 0.04 };
  const ALL_MECH = KB.MECHS.map((m) => m.id);
  function softmaxObj(logs) {
    const ks = Object.keys(logs);
    let mx = -Infinity;
    ks.forEach((k) => { mx = Math.max(mx, logs[k]); });
    let s = 0;
    const out = {};
    ks.forEach((k) => { out[k] = Math.exp(logs[k] - mx); s += out[k]; });
    ks.forEach((k) => { out[k] /= s; });
    return out;
  }
  const argmax = (o) => Object.keys(o).reduce((a, b) => (o[b] > o[a] ? b : a));
  const sorted = (o) => Object.keys(o).map((k) => [k, o[k]]).sort((a, b) => b[1] - a[1]);

  function mechGivenType(typeId, brandId, brandW) {
    const base = KB.TYPE_MECH[typeId] || KB.TYPE_MECH.inna;
    const T = KB.TYPE_BY_ID[typeId] || KB.OTHER_TYPE;
    const out = {};
    ALL_MECH.forEach((m) => { out[m] = base[m] || 0; });
    const B = brandId && KB.BRAND_BY_ID[brandId];
    if (B && brandW > 0 && T.family === "klucz") {
      const bt = (B.byType && B.byType[typeId]) || B.mech;
      let s = 0;
      KB.KEYED.forEach((m) => { out[m] = Math.pow((base[m] || 0) + 0.01, 1 - 0.75 * brandW) * Math.pow((bt[m] || 0) + 0.01, 0.75 * brandW); s += out[m]; });
      KB.KEYED.forEach((m) => { out[m] /= s; });
    }
    // Every keyed mechanism keeps a small floor so a clear keyway or key photo can always overturn the prior.
    if (T.family === "klucz") KB.KEYED.forEach((m) => { out[m] = Math.max(out[m], 0.004); });
    return out;
  }

  function estimate(S) {
    const ph = S.photos, ev = [];
    const types = KB.TYPES.map((t) => t.id);
    let wf = 0, wk = 0, wy = 0;
    ph.forEach((p) => { wf += p.w.front; wk += p.w.keyway; wy += p.w.key; });

    /* --- type --- */
    const logT = {};
    types.forEach((t) => { logT[t] = Math.log(TYPE_SHARE[t]) * 0.35; });
    ph.forEach((p) => {
      types.forEach((t) => { logT[t] += p.w.front * Math.log(p.typ[t] + EPS); });
      const m = Learn.match("typ", p);
      Object.keys(m).forEach((l) => { if (l in logT) logT[l] += 6 * m[l]; });
    });
    let PT = softmaxObj(logT);
    let typeSrc = "foto";
    if (S.user.typ && KB.TYPE_BY_ID[S.user.typ]) { PT = {}; types.forEach((t) => { PT[t] = t === S.user.typ ? 1 : 0; }); typeSrc = "user"; }
    else if (!ph.length) typeSrc = "brak";
    const typeId = argmax(PT);

    /* --- material --- */
    let matId = null, matP = 0;
    if (S.user.material) { matId = S.user.material; matP = 1; }
    else if (wf > 0.3) {
      const logM = {};
      KB.MATERIALS.forEach((m) => { logM[m.id] = 0; });
      ph.forEach((p) => KB.MATERIALS.forEach((m) => { logM[m.id] += p.w.front * Math.log(p.material[m.id] + EPS); }));
      const PM = softmaxObj(logM);
      const top = argmax(PM);
      if (PM[top] >= 0.5) { matId = top; matP = PM[top]; }
    }

    /* --- brand: only with a clear logo-like signal --- */
    let brandId = null, brandW = 0, brandSrc = null;
    if (S.user.brand) { brandId = S.user.brand === "brak" ? null : S.user.brand; brandW = brandId ? 1 : 0; brandSrc = "user"; }
    else {
      const acc = {};
      ph.forEach((p) => {
        const top = p.brandTop;
        if (top && top !== "brak" && KB.BRAND_BY_ID[top]) {
          const w = p.w.front * clamp((p.brandMargin - 0.03) / 0.03, 0, 1) * p.brand[top];
          acc[top] = 1 - (1 - (acc[top] || 0)) * (1 - w);
        }
        const m = Learn.match("brand", p);
        Object.keys(m).forEach((l) => { if (KB.BRAND_BY_ID[l]) acc[l] = 1 - (1 - (acc[l] || 0)) * (1 - 0.9 * m[l]); });
      });
      const best = Object.keys(acc).sort((a, b) => acc[b] - acc[a])[0];
      if (best && acc[best] >= 0.25) { brandId = best; brandW = clamp(acc[best], 0, 1); brandSrc = "foto"; }
    }

    /* --- mechanism: prior from type + brand, then keyway / key evidence --- */
    const prior = {};
    ALL_MECH.forEach((m) => { prior[m] = 0; });
    types.forEach((t) => {
      if (PT[t] < 1e-4) return;
      const pm = mechGivenType(t, brandId, brandW);
      ALL_MECH.forEach((m) => { prior[m] += PT[t] * pm[m]; });
    });
    const logL = {};
    ALL_MECH.forEach((m) => { logL[m] = 0; });
    const K = KB.KEYED.length;
    const directCues = [];
    ph.forEach((p) => {
      const a = 1.7 * p.w.keyway + 0.3 * p.w.front, b = 2.0 * p.w.key;
      KB.KEYED.forEach((m) => { logL[m] += a * Math.log(K * p.keyway[m] + EPS) + b * Math.log(K * p.key[m] + EPS); });
      ["kola", "tarcza_szyfrowa", "elektroniczny"].forEach((m) => { logL[m] += (p.w.keyway + p.w.key) * Math.log(0.3); });
      if (p.w.keyway >= 0.4) directCues.push({ n: p.n, kind: "otwór", top: argmax(p.keyway), p: p.keyway[argmax(p.keyway)] });
      if (p.w.key >= 0.4) directCues.push({ n: p.n, kind: "klucz", top: argmax(p.key), p: p.key[argmax(p.key)] });
      const m = Learn.match("mech", p);
      Object.keys(m).forEach((l) => { if (l in logL) logL[l] += 6 * m[l]; });
    });
    const post = {};
    ALL_MECH.forEach((m) => { post[m] = Math.log(prior[m] + 1e-9) + logL[m]; });
    let PMe = softmaxObj(post);
    let mechSrc = ph.length ? "foto" : "brak";
    if (S.user.mech && KB.MECH_BY_ID[S.user.mech]) { PMe = {}; ALL_MECH.forEach((m) => { PMe[m] = m === S.user.mech ? 1 : 0; }); mechSrc = "user"; }
    const mechId = argmax(PMe);
    const alts = sorted(PMe).filter(([m, p]) => m !== mechId && p >= 0.04).slice(0, 3);

    /* --- evidence list (Jak to ustalono) --- */
    const VIEWNAME = { front: "kłódka", keyway: "otwór na klucz", key: "klucz" };
    ph.forEach((p) => {
      let line = "Zdjęcie " + p.n + ": " + VIEWNAME[p.kind];
      if (p.kind === "front") { const t = argmax(p.typ); line += " — wygląda jak: " + KB.TYPE_BY_ID[t].name.toLowerCase() + " (" + pct(p.typ[t]) + ")"; }
      else if (p.kind === "keyway") { const m = argmax(p.keyway); line += " — kształt wskazuje: " + KB.MECH_BY_ID[m].name.toLowerCase() + " (" + pct(p.keyway[m]) + ")"; }
      else { const m = argmax(p.key); line += " — kształt wskazuje: " + KB.MECH_BY_ID[m].name.toLowerCase() + " (" + pct(p.key[m]) + ")"; }
      if (p.gate.nic > 0.6) line += "; zdjęcie słabo przypomina kłódkę";
      ev.push(line);
    });
    if (brandId) ev.push("Marka: " + KB.BRAND_BY_ID[brandId].name + (brandSrc === "user" ? " (wybrana przez Ciebie)" : " — rozpoznana po logo lub wyglądzie (" + pct(brandW) + ")"));
    if (typeSrc === "user") ev.push("Typ potwierdzony przez Ciebie: " + KB.TYPE_BY_ID[S.user.typ].name.toLowerCase());
    if (mechSrc === "user") ev.push("Mechanizm potwierdzony przez Ciebie");
    else if (ph.length) {
      const pr = argmax(prior);
      ev.push("Sam wygląd i marka sugerują: " + KB.MECH_BY_ID[pr].name.toLowerCase() + " (" + pct(prior[pr]) + ")" + (directCues.length ? "; zdjęcia otworu lub klucza zmieniły to na " + pct(PMe[mechId]) + " dla wyniku" : ""));
    }
    const learnedHits = ph.some((p) => Object.keys(Learn.match("mech", p)).length || Object.keys(Learn.match("typ", p)).length);
    if (learnedHits) ev.push("Pomogły Twoje wcześniejsze poprawki podobnej kłódki");

    return {
      type: { id: typeId, p: PT[typeId], dist: PT, src: typeSrc },
      material: { id: matId, p: matP },
      brand: { id: brandId, w: brandW, src: brandSrc },
      mech: { id: mechId, p: PMe[mechId], dist: PMe, alts, src: mechSrc, prior },
      seen: { front: wf, keyway: wk, key: wy },
      lockLike: ph.length ? Math.max(...ph.map((p) => 1 - p.gate.nic)) : 1,
      evidence: ev,
      directCues
    };
  }

  /* ======================= Ratings and care ======================= */

  function certLevel(marks) { return Math.max(KB.EN_LEVEL[marks.cen] || 0, (KB.SS[marks.ss] && KB.SS[marks.ss].level) || 0); }

  // Quality of the mechanism on a 1–5 scale (part of the overall resistance rating).
  function mechScore(mechId, brandId, typeId, marks) {
    const M = KB.MECH_BY_ID[mechId], B = brandId && KB.BRAND_BY_ID[brandId];
    let s = M ? M.sec : 3;
    if (B && B.secBoost && M && M.keyed) s += B.secBoost;
    if (typeId === "tsa" || typeId === "linkowa") s = Math.min(s, 2);
    const cert = certLevel(marks);
    if (cert) s = Math.max(s, cert - 1);
    return clamp(s, 1, 5);
  }

  function ratings(est, marks) {
    const T = KB.TYPE_BY_ID[est.type.id] || KB.OTHER_TYPE;
    const Mt = KB.MAT_BY_ID[est.material.id];
    let cut = T.base.cut, impact = T.base.impact, weather = T.base.weather;
    let mech = mechScore(est.mech.id, est.brand.id, T.id, marks);
    if (Mt) { weather = Mt.weather == null ? weather + 1 : Mt.weather; impact += Mt.impact; }
    if (T.id === "elektroniczna") weather = Math.min(weather, 3);
    if (marks.boron) cut += 2; else if (marks.hardened) cut += 1;
    if (marks.width) { if (marks.width < 30) { cut -= 1; impact -= 1; } else if (marks.width >= 60) { cut += 1; impact += 1; } }
    const cert = certLevel(marks);
    if (cert) { cut = Math.max(cut, cert - 1); impact = Math.max(impact, cert - 1); mech = Math.max(mech, cert - 1); }
    cut = clamp(cut, 1, 5); impact = clamp(impact, 1, 5); weather = clamp(weather, 1, 5); mech = clamp(mech, 1, 5);
    return { overall: cert || Math.min(cut, impact, mech), cut, impact, mech, weather, cert: !!cert };
  }

  // Spare key and upkeep — for the owner of the padlock.
  function careItems(est) {
    const M = KB.MECH_BY_ID[est.mech.id], T = KB.TYPE_BY_ID[est.type.id] || KB.OTHER_TYPE, B = est.brand.id && KB.BRAND_BY_ID[est.brand.id];
    const out = [];
    if (M.keyed) {
      out.push({ n: "Zapasowy klucz", d: "Dorobisz go " + (KB.DUPLICATE[M.id] || "u ślusarza") + ". Zrób to, zanim zgubisz oryginał." + (B && B.key ? " " + B.key : "") });
      out.push({ n: "Karta kodowa lub numer klucza", d: "Trzymaj je osobno od kłódki — bez nich duplikat markowego klucza bywa niemożliwy." });
      out.push({ n: "Zgubiony klucz", d: "Z kartą kodową zamów klucz u producenta lub w autoryzowanym punkcie. Bez niej zwróć się do zakładu ślusarskiego i miej dowód, że kłódka jest Twoja." });
    }
    if (M.id === "kola" || M.id === "tarcza_szyfrowa") {
      out.push({ n: "Zapisz szyfr w bezpiecznym miejscu", d: "Np. w menedżerze haseł. Po zamknięciu przekręć kółka, żeby szyfr nie był widoczny." });
      out.push({ n: "Zapomniany szyfr", d: "Niektórzy producenci odtworzą szyfr z numeru seryjnego po okazaniu dowodu zakupu." });
    }
    if (M.id === "elektroniczny") out.push({ n: "Kabel USB i powerbank", d: "Rozładowany akumulator uniemożliwi otwarcie — ładuj kłódkę, zanim spadnie poniżej 20%." });
    if (M.keyed || M.id === "kola" || M.id === "tarcza_szyfrowa") out.push({ n: "Smar PTFE lub grafitowy", d: "Raz na pół roku. Nie używaj zwykłego oleju — zbiera kurz i zacina mechanizm." });
    if (T.id !== "tsa" && T.id !== "elektroniczna") out.push({ n: "Odmrażacz do zamków", d: "Zimą wilgoć w mechanizmie zamarza — użyj odmrażacza, nie gorącej wody." });
    if (est.material.id === "stal" || T.id === "laminowana") out.push({ n: "Osłona przed deszczem", d: "Stalowy korpus rdzewieje. Osłonka albo wieszanie otworem w dół chroni mechanizm." });
    return out.slice(0, 6);
  }

  function cautions(est, marks) {
    const T = KB.TYPE_BY_ID[est.type.id] || KB.OTHER_TYPE, out = [];
    if (T.id === "standard" || T.id === "laminowana") out.push("Odsłonięty pałąk to najsłabsze miejsce kłódki.");
    if (T.id === "linkowa") out.push("Linkę łatwo przeciąć — chroni głównie przed okazją.");
    if (T.id === "tsa") out.push("Chroni głównie przed otwarciem z ciekawości, nie przed kradzieżą.");
    if (T.id === "elektroniczna") out.push("Rozładowany akumulator może uniemożliwić otwarcie.");
    if (est.mech.id === "plytkowy" || est.mech.id === "przeszkodowy") out.push("Ten mechanizm daje niską ochronę.");
    if (est.material.id === "aluminium") out.push("Aluminiowy korpus słabiej znosi uderzenia.");
    if (est.material.id === "stal" && T.id !== "laminowana") out.push("Stal bez powłoki rdzewieje — rdza zacina mechanizm.");
    if (marks.width && marks.width < 30) out.push("Mały korpus i cienki pałąk łatwiej pokonać.");
    return uniq(out).slice(0, 4);
  }

  /* ======================= Session state ======================= */

  const state = { busy: false, session: null, viewing: null, marksOpen: false };
  function newSession() {
    state.session = { id: "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), photos: [], user: {}, marks: {} };
    state.viewing = null;
    return state.session;
  }

  /* ======================= Image capture → tensors ======================= */

  const S224 = 224;
  function coverRect(sw, sh, vw, vh) {
    // The part of the camera frame that the viewfinder actually shows (object-fit: cover).
    if (!vw || !vh) return { x: 0, y: 0, w: sw, h: sh };
    const sa = sw / sh, va = vw / vh;
    if (sa > va) { const w = sh * va; return { x: (sw - w) / 2, y: 0, w, h: sh }; }
    const hh = sw / va;
    return { x: 0, y: (sh - hh) / 2, w: sw, h: hh };
  }
  // Views of one photo: 0 = whole visible frame (letterboxed), 1 = centre 85 %, 2 = centre 55 % (close detail).
  // `views` = how many of them to make (1 for the quick auto-capture check, 3 for a real photo).
  function makeTensors(src, rect, views) {
    views = views || 3;
    const mean = [0.48145466, 0.4578275, 0.40821073], std = [0.26862954, 0.26130258, 0.27577711];
    const per = 3 * S224 * S224, n = S224 * S224;
    const out = new Float32Array(views * per);
    const c = document.createElement("canvas");
    c.width = S224; c.height = S224;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const put = (off) => {
      const img = ctx.getImageData(0, 0, S224, S224), d = img.data;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        out[off + i] = (d[j] / 255 - mean[0]) / std[0];
        out[off + n + i] = (d[j + 1] / 255 - mean[1]) / std[1];
        out[off + 2 * n + i] = (d[j + 2] / 255 - mean[2]) / std[2];
      }
      d.fill(0);
    };
    // View 1: the whole visible frame, letterboxed on the mean colour.
    ctx.fillStyle = "rgb(123,117,104)";
    ctx.fillRect(0, 0, S224, S224);
    const s = S224 / Math.max(rect.w, rect.h), dw = rect.w * s, dh = rect.h * s;
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, (S224 - dw) / 2, (S224 - dh) / 2, dw, dh);
    put(0);
    const centre = (frac, off) => {
      const side = frac * Math.min(rect.w, rect.h);
      ctx.drawImage(src, rect.x + (rect.w - side) / 2, rect.y + (rect.h - side) / 2, side, side, 0, 0, S224, S224);
      put(off);
    };
    if (views > 1) centre(0.85, per);
    if (views > 2) centre(0.55, 2 * per);
    const q = quality(src, rect);
    ctx.clearRect(0, 0, S224, S224);
    c.width = 0; c.height = 0;
    return { pixels: out, q };
  }
  function quality(src, rect) {
    const W = 192, H = Math.max(8, Math.round(W * rect.h / rect.w));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H), d = img.data, g = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0, j = 0; i < g.length; i++, j += 4) { g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]; sum += g[i]; }
    d.fill(0);
    let a = 0, a2 = 0, m = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, L = g[i - 1] + g[i + 1] + g[i - W] + g[i + W] - 4 * g[i];
      a += L; a2 += L * L; m++;
    }
    g.fill(0);
    c.width = 0; c.height = 0;
    return { mean: sum / (W * H), sharp: m ? a2 / m - (a / m) * (a / m) : 0, w: Math.round(rect.w), h: Math.round(rect.h) };
  }
  function qualityNotes(q) {
    const out = [];
    if (!q) return out;
    if (q.sharp < 30) out.push("Zdjęcie jest nieostre");
    if (q.mean < 50) out.push("Zdjęcie jest ciemne");
    else if (q.mean > 220) out.push("Zdjęcie jest prześwietlone");
    if (Math.min(q.w, q.h) < 360) out.push("Zdjęcie ma niską rozdzielczość");
    return out;
  }

  /* ======================= Camera ======================= */

  const els = {
    finder: $("finder"), cam: $("cam"), finderArt: $("finderArt"), finderTag: $("finderTag"), finderTap: $("finderTap"),
    finderMsg: $("finderMsg"), finderMsgText: $("finderMsgText"), shutter: $("shutter"), shutterText: $("shutterText"),
    galInput: $("galInput"), camInput: $("camInput"), newBtn: $("newBtn"), hint: $("hint"), result: $("result"),
    modelStatus: $("modelStatus"), modelText: $("modelText"), modelBar: $("modelBar"),
    history: $("history"), histList: $("histList"), histTools: $("histTools"), types: $("types"), mechList: $("mechList"), scaleList: $("scaleList"),
    learnSwitch: $("learnSwitch"), dataInfo: $("dataInfo"), wipeBtn: $("wipeBtn")
  };
  const Cam = {
    stream: null, idle: null, denied: false,
    get live() { return !!this.stream; },
    available() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    async start() {
      if (this.stream) return true;
      if (!this.available()) return false;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
      } catch (e) {
        this.stream = null;
        this.denied = !!(e && (e.name === "NotAllowedError" || e.name === "SecurityError"));
        return false;
      }
      const v = els.cam;
      v.srcObject = this.stream;
      v.hidden = false;
      els.finderArt.hidden = true;
      try { await v.play(); } catch (e) { /* autoplay with muted should work */ }
      for (let i = 0; i < 40 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
      this.bump();
      updateFinder();
      Auto.start();
      return true;
    },
    stop() {
      Auto.stop();
      clearTimeout(this.idle);
      if (this.stream) this.stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* ignore */ } });
      this.stream = null;
      els.cam.pause();
      els.cam.srcObject = null;
      els.cam.hidden = true;
      els.finderArt.hidden = false;
      updateFinder();
    },
    bump() { clearTimeout(this.idle); this.idle = setTimeout(() => this.stop(), 120000); }
  };

  /* Auto-capture: about once a second the live frame is checked (one quick view). When the frame shows
     the view the result still needs (whole lock, keyway or key), is sharp, and stays steady for two
     checks, the photo is taken by itself. Each checked frame is wiped like a normal photo. */
  function wantedKinds() {
    const S = state.session;
    if (!S || !S.photos.length || state.viewing) return ["front", "keyway", "key"];
    const ask = nextAsk(estimate(S));
    if (!ask) return [];
    return S.photos.some((p) => p.kind === ask) ? [] : [ask];
  }
  const Auto = {
    timer: null, last: null, streak: 0, cooldown: 0, running: false, gen: 0,
    get on() { return settings.auto !== false; },
    start() {
      this.stop();
      if (!this.on || !Cam.live) return;
      const g = this.gen;
      this.timer = setTimeout(() => this.tick(g), 1100);
    },
    stop() { clearTimeout(this.timer); this.timer = null; this.streak = 0; this.last = null; this.gen++; },
    later(ms, g) { if (g === this.gen && this.on && Cam.live) { clearTimeout(this.timer); this.timer = setTimeout(() => this.tick(g), ms); } },
    async tick(g) {
      if (g !== this.gen) return; // stopped or restarted meanwhile
      this.timer = null;
      if (!this.on || !Cam.live || document.hidden) return;
      if (state.busy || this.running || Model.st.state !== "ready" || Date.now() < this.cooldown) { this.later(700, g); return; }
      const want = wantedKinds();
      if (!want.length) { updateFinder(); return; } // result complete — wait for the shutter or "Nowa kłódka"
      const v = els.cam;
      if (!v.videoWidth) { this.later(500, g); return; }
      this.running = true;
      let ok = false, e = null;
      try {
        const rect = coverRect(v.videoWidth, v.videoHeight, els.finder.clientWidth, els.finder.clientHeight);
        const t = makeTensors(v, rect, 1);
        const emb = await Model.embed(t.pixels, 1);
        e = Float32Array.from(emb);
        emb.fill(0);
        const g = scoreEmbedding(e).gate, w = viewWeights(g), kind = viewKind(w);
        const conf = kind === "front" ? g.klodka : kind === "keyway" ? g.otwor : g.klucz;
        ok = want.includes(kind) && conf >= (kind === "front" ? 0.55 : 0.5) && t.q.sharp >= 30 && t.q.mean >= 45 && t.q.mean <= 225;
      } catch (x) { ok = false; }
      this.running = false;
      if (g !== this.gen) return;
      if (!Cam.live || state.busy) { this.later(800, g); return; }
      this.streak = ok && this.last && cos(this.last, e) > 0.92 ? this.streak + 1 : ok ? 1 : 0;
      this.last = ok ? e : null;
      if (this.streak >= 2) {
        this.streak = 0; this.last = null;
        this.cooldown = Date.now() + 2500;
        capture(true);
        return; // analyze() restarts the loop
      }
      this.later(ok ? 450 : 900, g);
    }
  };

  async function focusCamera() {
    $("scanner").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    if (!Cam.live) {
      const ok = await Cam.start();
      if (!ok) { updateFinder(); renderCameraHelp(); return; }
    }
    updateFinder();
    Auto.start();
  }

  function finderMsg(text, ms) {
    els.finderMsgText.textContent = text;
    els.finderMsg.hidden = !text;
    clearTimeout(finderMsg.t);
    if (text && ms) finderMsg.t = setTimeout(() => { els.finderMsg.hidden = true; }, ms);
  }
  function nextAsk(est) {
    if (!est) return "front";
    if (est.mech.src === "user") return null;
    const keyed = (KB.MECH_BY_ID[est.mech.id] || {}).keyed;
    if (est.seen.front < 0.3) return "front";
    if (keyed && est.seen.keyway < 0.4 && est.mech.p < 0.9) return "keyway";
    if (keyed && est.seen.key < 0.4 && est.mech.p < 0.75) return "key";
    return null;
  }
  function updateFinder() {
    const est = state.session && state.session.photos.length && !state.viewing ? estimate(state.session) : null;
    const ask = est ? nextAsk(est) : "front";
    let tag;
    if (state.busy) tag = "Analizuję…";
    else if (!Cam.live) tag = Cam.denied ? "Brak dostępu do aparatu" : "Dotknij, aby włączyć aparat";
    else if (ask && Auto.on && wantedKinds().length) tag = ask === "keyway" ? "Auto: pokaż otwór na klucz z bliska" : ask === "key" ? "Auto: pokaż klucz" : "Auto: celuj w kłódkę";
    else tag = ask === "keyway" ? "Teraz: zbliżenie otworu na klucz" : ask === "key" ? "Teraz: klucz na jasnym tle" : ask === "front" ? "Cała kłódka w kadrze" : "Gotowe · możesz dodać zdjęcie";
    els.finderTag.textContent = tag;
    els.finder.dataset.state = state.busy ? "busy" : Cam.live ? "live" : "idle";
    els.finderTap.hidden = Cam.live;
    els.shutterText.textContent = Cam.live ? (ask === "keyway" ? "Zdjęcie otworu" : ask === "key" ? "Zdjęcie klucza" : "Zrób zdjęcie") : "Włącz aparat";
    els.newBtn.hidden = !(state.session && state.session.photos.length);
    els.shutter.disabled = state.busy;
    els.galInput.disabled = state.busy;
  }

  async function onShutter() {
    if (state.busy) return;
    if (!Cam.live) {
      if (!Cam.available()) { els.camInput.click(); return; }
      const ok = await Cam.start();
      if (!ok) {
        updateFinder();
        renderCameraHelp();
      }
      return;
    }
    capture();
  }

  function capture(auto) {
    const v = els.cam;
    if (!v.videoWidth) { if (!auto) toast("Aparat jeszcze się uruchamia"); return; }
    Cam.bump();
    Auto.stop();
    const rect = coverRect(v.videoWidth, v.videoHeight, els.finder.clientWidth, els.finder.clientHeight);
    let t;
    try { t = makeTensors(v, rect, 3); } catch (e) { toast("Nie udało się pobrać obrazu z aparatu"); Auto.start(); return; }
    try { v.pause(); } catch (e) { /* freeze the preview during analysis */ }
    analyze(t.pixels, t.q, auto ? "auto" : "aparat").finally(() => {
      if (Cam.live) v.play().catch(() => {});
      Auto.start();
    });
  }

  async function onFile(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file || state.busy) return;
    let src = null, url = null;
    try {
      try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch (e) { src = await createImageBitmap(file); }
    } catch (e) {
      try {
        url = URL.createObjectURL(file);
        src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      } catch (x) { src = null; }
    }
    if (!src) { if (url) URL.revokeObjectURL(url); toast("Nie da się otworzyć tego zdjęcia. Wybierz JPG lub PNG."); return; }
    const W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
    let t = null;
    try { t = makeTensors(src, { x: 0, y: 0, w: W, h: H }); } catch (e) { t = null; }
    if (src.close) src.close();
    if (url) URL.revokeObjectURL(url);
    src = null;
    if (!t) { toast("Nie udało się odczytać zdjęcia"); return; }
    await analyze(t.pixels, t.q, input === els.camInput ? "aparat" : "galeria");
  }

  async function analyze(pixels, q, source) {
    if (!state.session || state.viewing) newSession();
    const S = state.session;
    setBusy(true);
    finderMsg(Model.st.state === "ready" ? "Analizuję zdjęcie…" : "Czekam na model rozpoznawania…");
    let emb = null;
    try {
      emb = await Model.embed(pixels, 3);
      pixels = null;
    } catch (e) {
      pixels = null;
      setBusy(false);
      finderMsg("Zdjęcie usunięte z pamięci", 2500);
      if (Model.st.state !== "error") { toast("Model jeszcze się uruchamia — zrób zdjęcie ponownie za chwilę", 3200); return; }
      renderManual("Rozpoznawanie ze zdjęcia jest teraz niedostępne. Wybierz typ i mechanizm, a ocenię kłódkę.");
      return;
    }
    if (state.session !== S) { emb.fill(0); setBusy(false); return; } // a new padlock was started meanwhile
    const D = emb.length / 3;
    const mix = (a, b) => {
      const v = new Float32Array(D);
      let nrm = 0;
      for (let i = 0; i < D; i++) { v[i] = emb[a * D + i] + emb[b * D + i]; nrm += v[i] * v[i]; }
      nrm = Math.sqrt(nrm) || 1;
      for (let i = 0; i < D; i++) v[i] /= nrm;
      return v;
    };
    // Whole frame + centre for the scene (type, brand, material, key); centre + close crop for the keyway.
    const e = mix(0, 1), eClose = mix(1, 2);
    emb.fill(0);
    const sc = scoreEmbedding(e);
    sc.keyway = scoreEmbedding(eClose).keyway;
    const w = viewWeights(sc.gate);
    const photo = Object.assign({ n: S.photos.length + 1, source, e, q, w, kind: viewKind(w) }, sc);
    // A front photo of something clearly different from the first one = probably a new padlock.
    const firstFront = S.photos.find((p) => p.kind === "front");
    if (firstFront && photo.kind === "front" && cos(firstFront.e, e) < 0.72 && !S.user.typ && !S.user.mech) {
      newSession();
      photo.n = 1;
      state.session.photos.push(photo);
      toast("To wygląda na inną kłódkę — zaczynam nowy wynik", 3200);
    } else {
      S.photos.push(photo);
    }
    setBusy(false);
    const notes = qualityNotes(q);
    finderMsg(source === "galeria" ? "Zdjęcie przeanalizowane. Oryginał zostaje w galerii."
      : source === "auto" ? "Zdjęcie zrobione samo, przeanalizowane i usunięte ✓" : "Zdjęcie przeanalizowane i usunięte ✓", 2600);
    if (notes.length) toast(notes.join(" · ") + ". Spróbuj jeszcze raz, jeśli wynik jest niepewny.", 3600);
    showSession(true);
  }

  function setBusy(b) {
    state.busy = b;
    updateFinder();
  }

  /* ======================= Rendering ======================= */

  const chip = (tone, text) => h("span", { class: "chip" + (tone ? " tone-" + tone : "") }, h("span", { class: "dot", "aria-hidden": "true" }), text);
  function setResult(node) { clear(els.result); els.result.append(node); }
  function revealResult() {
    const r = els.result.getBoundingClientRect(), vh = window.innerHeight || 700;
    if (r.top < 0 || r.top > vh * 0.7) window.scrollBy({ top: r.top - Math.min(vh * 0.12, 90), behavior: reduceMotion() ? "auto" : "smooth" });
  }
  function meter5(v, label) {
    const bar = h("div", { class: "meter-bar" });
    for (let i = 1; i <= 5; i++) bar.append(h("span", { class: i <= v ? "on" : null }));
    return h("div", { role: "img", "aria-label": label }, bar);
  }
  function subrate(label, v) {
    const mini = h("div", { class: "mini5", "aria-hidden": "true" });
    for (let i = 1; i <= 5; i++) mini.append(h("span", { class: i <= v ? "on" : null }));
    return h("div", { class: "subrate", style: "--lvl: var(--" + toneOf(v) + ")" }, h("span", { text: label }), mini, h("b", { text: v + "/5" }));
  }
  function opt(props, iconHtml, title, sub, tag) {
    return h("button", { type: "button", class: "opt" + (props.cls ? " " + props.cls : ""), onclick: props.onclick, "aria-pressed": props.sel ? "true" : null },
      iconHtml ? h("span", { class: "oi", html: iconHtml }) : null,
      h("b", { text: title }), sub ? h("small", { text: sub }) : null, tag ? h("span", { class: "tag", text: tag }) : null);
  }

  function showSession(fresh) {
    const S = state.session;
    if (!S) return;
    const est = estimate(S);
    renderResult(est, S, fresh ? "live-new" : "live");
    saveHistory(S, est);
    updateFinder();
    if (fresh) revealResult();
    if (Cam.live && !state.busy) Auto.start();
  }

  function mechBlock(est, S, mode) {
    const M = KB.MECH_BY_ID[est.mech.id];
    const p = est.mech.p, user = est.mech.src === "user";
    const tone = user ? "good" : confTone(p);
    const kids = [
      h("div", { class: "mech-top" },
        h("span", { class: "oi", html: icon(M.icon) }),
        h("p", { class: "mech-name" }, M.name, h("small", { text: M.en })),
        h("span", { class: "mech-pct", text: user ? "✓" : pct(Math.min(p, 0.99)), "aria-label": user ? "potwierdzone" : "pewność " + pct(p) })),
      h("div", { class: "confbar", role: "img", "aria-label": "Pewność " + pct(p) }, h("i", { style: "width:" + Math.round((user ? 1 : p) * 100) + "%" }))
    ];
    if (!user && est.mech.alts.length) {
      kids.push(h("ul", { class: "alts", "aria-label": "Inne możliwe mechanizmy" }, est.mech.alts.map(([m, q]) => h("li", null,
        h("span", { text: KB.MECH_BY_ID[m].name }), h("span", { class: "mini" }, h("i", { style: "width:" + Math.round(q * 100) + "%" })), h("b", { text: pct(q) })))));
    }
    kids.push(h("p", { class: "verify" }, h("b", { text: "Po czym poznać: " }), lower1(M.key) + "; otwór: " + lower1(M.hole) + "."));
    if (mode !== "history") {
      const ask = nextAsk(est);
      // The brand on the body is the cheapest strong clue (e.g. Abloy → disc detainer): one tap.
      if (!user && p < 0.85 && M.keyed && !est.brand.id && S.user.brand !== "brak") {
        kids.push(h("div", { class: "picker" }, h("p", { class: "picker-q", text: "Widzisz markę na korpusie?" }),
          h("div", { class: "toggles" }, ["abus", "masterlock", "abloy", "multlock", "yale", "burg", "squire"].map((id) =>
            h("button", { type: "button", class: "toggle", onclick: () => setUser("brand", id) }, KB.BRAND_BY_ID[id].name)),
          h("button", { type: "button", class: "toggle", onclick: () => setUser("brand", "brak") }, "Brak / inna"))));
      }
      if (!user && p < 0.75 && M.keyed) {
        kids.push(mechQuestion(est, S));
      } else if (ask === "keyway" || ask === "key") {
        kids.push(h("div", { class: "callout" },
          h("p", { text: ask === "keyway" ? "Żeby potwierdzić mechanizm, pokaż aparatowi otwór na klucz z bliska — zwykle od spodu kłódki." : "Jeśli masz klucz, pokaż go aparatowi — kształt klucza rozstrzyga." }),
          h("div", { class: "row-actions" }, h("button", { type: "button", class: "btn btn-primary", onclick: focusCamera }, ask === "keyway" ? "Zdjęcie otworu" : "Zdjęcie klucza"))));
      }
      kids.push(h("details", { class: "fold" }, h("summary", null, "To inny mechanizm"), h("div", { class: "fold-body" }, mechPicker(est, S))));
    }
    return h("div", { class: "block" }, h("h3", { class: "block-title", text: "Mechanizm" }), h("div", { class: "mech", style: "--lvl: var(--" + tone + ")" }, kids),
      h("p", { class: "verify", text: user ? "Mechanizm potwierdzony przez Ciebie." : "Pewność: " + confWord(p) + "." + (p < 0.85 ? " Każde dodatkowe zdjęcie otworu lub klucza ją podnosi." : "") }));
  }

  function mechQuestion(est, S) {
    const cands = sorted(est.mech.dist).filter(([m]) => KB.MECH_BY_ID[m].keyed).slice(0, 4).map(([m]) => m);
    return h("div", { class: "picker callout warn" },
      h("p", { class: "picker-q", text: "Nie mam pewności. Który kształt klucza albo otworu widzisz?" }),
      h("div", { class: "opts list" }, cands.map((m) => {
        const M = KB.MECH_BY_ID[m];
        return optRow(() => setUser("mech", m), icon(M.icon), M.key, "Otwór: " + lower1(M.hole), pct(est.mech.dist[m]));
      }), optRow(focusCamera, null, "Nie wiem — pokażę otwór aparatowi", null, null)));
  }
  function optRow(onclick, iconHtml, title, sub, tag) {
    return h("button", { type: "button", class: "opt row", onclick },
      iconHtml ? h("span", { class: "oi", html: iconHtml }) : null,
      h("span", { class: "ot" }, h("b", { text: title }), sub ? h("small", { text: sub }) : null),
      tag ? h("span", { class: "pc", text: tag }) : null);
  }

  function mechPicker(est, S) {
    const T = KB.TYPE_BY_ID[est.type.id] || KB.OTHER_TYPE;
    const list = T.family === "klucz" ? KB.MECHS.filter((m) => m.keyed).concat(KB.MECHS.filter((m) => !m.keyed)) : KB.MECHS;
    return h("div", { class: "opts" }, list.map((M) => opt({ cls: est.mech.id === M.id && est.mech.src === "user" ? "sel" : "", onclick: () => setUser("mech", M.id) }, icon(M.icon), M.name, M.key)),
      est.mech.src === "user" ? opt({ cls: "wide", onclick: () => setUser("mech", null) }, null, "Wróć do rozpoznania ze zdjęć", null) : null);
  }

  function typePicker(est) {
    return h("div", { class: "opts" }, KB.TYPES.map((t) => opt({ cls: est.type.id === t.id && est.type.src === "user" ? "sel" : "", onclick: () => setUser("typ", t.id) }, icon(t.icon), t.name, null,
      est.type.src !== "user" && est.type.dist[t.id] >= 0.15 ? pct(est.type.dist[t.id]) : null)),
    est.type.src === "user" ? opt({ cls: "wide", onclick: () => setUser("typ", null) }, null, "Wróć do rozpoznania ze zdjęć", null) : null);
  }
  function brandPicker(est) {
    return h("div", { class: "toggles" }, KB.BRANDS.map((b) => h("button", { type: "button", class: "toggle", "aria-pressed": String(est.brand.id === b.id), onclick: () => setUser("brand", est.brand.id === b.id && est.brand.src === "user" ? null : b.id) }, b.name)),
      h("button", { type: "button", class: "toggle", "aria-pressed": String(state.session && state.session.user.brand === "brak"), onclick: () => setUser("brand", "brak") }, "Inna / brak"));
  }

  function setUser(field, value) {
    const S = state.session;
    if (!S) return;
    if (value == null) delete S.user[field]; else S.user[field] = value;
    // A combination or electronic mechanism decides the type too.
    const MECH_TYPE = { kola: "szyfrowa_kolka", tarcza_szyfrowa: "szyfrowa_tarcza", elektroniczny: "elektroniczna" };
    if (field === "mech" && MECH_TYPE[value] && !(value === "kola" && S.user.typ === "tsa")) S.user.typ = MECH_TYPE[value];
    if (value && value !== "brak") {
      const kinds = field === "mech" ? null : ["front"];
      const ph = S.photos.filter((p) => !kinds || kinds.includes(p.kind));
      Learn.add(field, value, ph);
      renderData();
    }
    showSession(false);
    if (value) toast("Zapisano poprawkę" + (settings.learn && S.photos.length ? " — zapamiętam ją na przyszłość" : ""));
  }

  function careBlock(est) {
    const items = careItems(est);
    if (!items.length) return null;
    return h("div", { class: "block" }, h("h3", { class: "block-title", text: "Klucz i konserwacja" }),
      h("ul", { class: "kit" }, items.map((t) => h("li", null, h("b", { text: t.n }), h("span", { text: t.d })))));
  }

  function marksBlock(marks, onChange) {
    const tog = (key, label) => h("button", { type: "button", class: "toggle", "aria-pressed": String(!!marks[key]), onclick: () => { marks[key] = !marks[key]; onChange(); } }, label);
    const seg = (key, values, labels) => h("div", { class: "segs", role: "group" }, values.map((v, i) => h("button", {
      type: "button", "aria-pressed": String((marks[key] || null) === v), onclick: () => { if (v == null) delete marks[key]; else marks[key] = v; onChange(); }
    }, labels[i])));
    const widthIn = h("input", { id: "widthInput", type: "number", inputmode: "numeric", min: "10", max: "150", placeholder: "np. 45", value: marks.width || null });
    widthIn.addEventListener("change", () => { const n = parseInt(widthIn.value, 10); if (n >= 10 && n <= 150) marks.width = n; else delete marks.width; onChange(); });
    return h("div", { class: "marks" },
      h("div", { class: "block" }, h("span", { class: "label", text: "Pałąk" }), h("div", { class: "toggles" }, tog("hardened", "HARDENED"), tog("boron", "BORON"))),
      h("div", { class: "block" }, h("span", { class: "label", text: "Klasa EN 12320 / CEN" }), seg("cen", [null, 1, 2, 3, 4, 5, 6], ["brak", "1", "2", "3", "4", "5", "6"])),
      h("div", { class: "block" }, h("span", { class: "label", text: "Sold Secure" }), seg("ss", [null, "bronze", "silver", "gold", "diamond"], ["brak", "Bronze", "Silver", "Gold", "Diamond"])),
      h("div", { class: "field" }, h("label", { class: "label", for: "widthInput", text: "Liczba na korpusie (szerokość, mm)" }), widthIn));
  }

  function ratingsBlock(R) {
    const L = KB.LEVELS[R.overall];
    return h("div", { class: "block" },
      h("h3", { class: "block-title", text: R.cert ? "Odporność (z certyfikatu)" : "Odporność (szacunek)" }),
      h("div", { class: "meter", style: "--lvl: var(--" + toneOf(R.overall) + ")" },
        meter5(R.overall, "Ogólna odporność " + R.overall + " na 5: " + L.name),
        h("div", { class: "meter-row" }, h("strong", { text: R.overall + "/5 · " + L.name }), h("span", { text: "typowo: " + L.uses }))),
      h("div", { class: "subrates" }, subrate("Przecięcie pałąka", R.cut), subrate("Uderzenie w korpus", R.impact), subrate("Mechanizm", R.mech), subrate("Pogoda i korozja", R.weather)));
  }

  function specsBlock(est, marks) {
    const T = KB.TYPE_BY_ID[est.type.id] || KB.OTHER_TYPE, B = est.brand.id && KB.BRAND_BY_ID[est.brand.id], Mt = KB.MAT_BY_ID[est.material.id];
    const M = KB.MECH_BY_ID[est.mech.id];
    const dl = h("dl", { class: "specs" });
    const add = (k, v, sub) => { if (v) dl.append(h("dt", { text: k }), h("dd", null, v, sub ? h("small", { text: sub }) : null)); };
    add("Typ", T.name, est.type.src === "user" ? "potwierdzony przez Ciebie" : est.type.src === "foto" ? "ze zdjęcia, pewność " + pct(est.type.p) : null);
    add("Marka", B ? B.name : "nie rozpoznano", B ? (est.brand.src === "user" ? "wybrana przez Ciebie" : "po logo lub wyglądzie — sprawdź napis na korpusie") : "logo nieczytelne albo brak");
    add("Otwieranie", M.keyed ? "Klucz" : M.id === "elektroniczny" ? "Elektronicznie" : "Szyfr");
    add("Korpus", Mt ? Mt.name : null, Mt ? Mt.hint : null);
    add("Pałąk", marks.boron ? "Stal borowa (BORON)" : marks.hardened ? "Stal hartowana (HARDENED)" : T.id === "linkowa" ? "Stalowa linka" : null);
    const certText = [marks.cen ? "EN 12320 klasa " + marks.cen : null, KB.SS[marks.ss] ? "Sold Secure " + KB.SS[marks.ss].name : null].filter(Boolean).join(", ");
    add("Certyfikat", certText || null);
    if (marks.width) add("Szerokość", marks.width + " mm");
    return dl;
  }

  function renderResult(est, S, mode) {
    const T = KB.TYPE_BY_ID[est.type.id] || KB.OTHER_TYPE, B = est.brand.id && KB.BRAND_BY_ID[est.brand.id];
    const marks = S.marks;
    const R = ratings(est, marks);
    const n = S.photos.length;
    const chips = [];
    const mp = est.mech.src === "user" ? 1 : est.mech.p;
    chips.push(chip(est.mech.src === "user" ? "good" : confTone(mp), "Mechanizm: " + (est.mech.src === "user" ? "potwierdzony" : confWord(mp))));
    if (mode !== "history" && n) chips.push(chip("good", n + " " + plural(n, "zdjęcie", "zdjęcia", "zdjęć") + " · usunięte z pamięci"));
    if (mode === "history") chips.push(chip("", "Z historii · " + fmtDate(S.ts)));
    if (n && est.lockLike < 0.45) chips.push(chip("warn", "Zdjęcie słabo przypomina kłódkę"));
    const desc = T.opis + (B && B.note ? " " + B.note : "");
    const head = h("div", { class: "plate-head" },
      h("p", { class: "eyebrow", text: mode === "history" ? "Z historii" : "Wynik" + (n ? " · " + n + " " + plural(n, "zdjęcie", "zdjęcia", "zdjęć") : "") }),
      h("h2", { class: "plate-title", text: T.title + (B ? " " + B.name : "") }),
      h("div", { class: "chips" }, chips),
      h("p", { class: "plate-desc", text: desc }));
    if (n && est.lockLike < 0.45 && mode !== "history") head.append(h("div", { class: "callout warn" }, h("p", { text: "Na zdjęciu słabo widać kłódkę. Wynik jest orientacyjny — zrób zdjęcie z bliska, tak żeby kłódka wypełniała kadr." })));
    if (est.type.src !== "user" && est.type.p < 0.5 && mode !== "history" && n) {
      const top = sorted(est.type.dist).slice(0, 3);
      head.append(h("div", { class: "picker" }, h("p", { class: "picker-q", text: "Który to typ? Jedno dotknięcie poprawi wynik." }),
        h("div", { class: "toggles" }, top.map(([t, p]) => h("button", { type: "button", class: "toggle", onclick: () => setUser("typ", t) }, KB.TYPE_BY_ID[t].name + " · " + pct(p))))));
    }
    const rerender = () => { if (mode === "history") renderResult(est, S, mode); else showSession(false); };
    const cau = cautions(est, marks);
    const body = h("div", { class: "plate-body" },
      mechBlock(est, S, mode),
      careBlock(est),
      h("div", { class: "block" }, h("h3", { class: "block-title", text: "Kłódka" }), specsBlock(est, marks),
        mode !== "history" ? h("details", { class: "fold" }, h("summary", null, "Popraw typ"), h("div", { class: "fold-body" }, typePicker(est))) : null,
        mode !== "history" ? h("details", { class: "fold" }, h("summary", null, "Popraw markę"), h("div", { class: "fold-body" }, brandPicker(est))) : null,
        h("details", { class: "fold", open: state.marksOpen ? true : null, ontoggle: (ev) => { state.marksOpen = ev.currentTarget.open; } }, h("summary", null, "Oznaczenia z korpusu"), h("div", { class: "fold-body" },
          h("p", { class: "verify", text: "Napisy na korpusie i pałąku poprawiają ocenę odporności." }), marksBlock(marks, rerender)))),
      ratingsBlock(R),
      cau.length ? h("div", { class: "block" }, h("h3", { class: "label", text: "Słabe punkty" }), h("ul", { class: "ticks warn" }, cau.map((t) => h("li", { text: t })))) : null,
      est.evidence.length ? h("section", { class: "how", "aria-label": "Jak to ustalono" }, h("h3", { class: "how-title", text: "Jak to ustalono" }), h("ul", { class: "ticks check" }, est.evidence.map((t) => h("li", { text: t })))) : null,
      h("div", { class: "row-actions" },
        h("button", { class: "btn", type: "button", onclick: () => copyResult(est, S) }, "Kopiuj opis"),
        mode !== "history" ? h("button", { class: "btn", type: "button", onclick: startNew }, "Nowa kłódka") : h("button", { class: "btn", type: "button", onclick: startNew }, "Skanuj nową")));
    setResult(h("article", { class: "plate" + (mode === "live-new" ? " enter" : "") }, head, body,
      h("div", { class: "plate-foot" }, h("p", { text: "Szacunek z wyglądu, policzony na telefonie. Mechanizm potwierdzisz, patrząc na klucz albo otwór." }))));
    markGuide(T.id);
  }

  function renderManual(msg) {
    if (!state.session) newSession();
    const S = state.session;
    setResult(h("article", { class: "plate" },
      h("div", { class: "plate-head" }, h("p", { class: "eyebrow", text: "Ocena bez modelu" }), h("h2", { class: "plate-title", text: "Wybierz typ i mechanizm" }), h("p", { class: "plate-desc", text: msg })),
      h("div", { class: "plate-body" },
        h("div", { class: "picker" }, h("p", { class: "picker-q", text: "Która kłódka wygląda jak Twoja?" }), h("div", { class: "opts" }, KB.TYPES.map((t) => opt({ cls: S.user.typ === t.id ? "sel" : "", onclick: () => { S.user.typ = t.id; renderManual(msg); } }, icon(t.icon), t.name)))),
        h("div", { class: "picker" }, h("p", { class: "picker-q", text: "Jak wygląda klucz albo otwór?" }), h("div", { class: "opts" }, KB.MECHS.map((m) => opt({ cls: S.user.mech === m.id ? "sel" : "", onclick: () => { S.user.mech = m.id; renderManual(msg); } }, icon(m.icon), m.key, m.name)))),
        h("div", { class: "row-actions" },
          h("button", { class: "btn btn-primary", type: "button", disabled: !(S.user.typ || S.user.mech) ? true : null, onclick: () => showSession(true) }, "Pokaż wynik"),
          Model.st.state === "error" ? h("button", { class: "btn", type: "button", onclick: () => { Model.retry(); toast("Ponawiam wczytywanie modelu"); } }, "Spróbuj wczytać model") : null))));
    revealResult();
  }

  function renderCameraHelp() {
    const msg = Cam.denied
      ? "Aplikacja nie ma dostępu do aparatu. Zezwól na aparat w ustawieniach przeglądarki albo zrób zdjęcie aparatem systemowym — plik nie zostanie zapisany w galerii."
      : "Ten telefon nie udostępnia podglądu aparatu w aplikacji. Zrób zdjęcie aparatem systemowym albo wybierz je z galerii.";
    setResult(h("article", { class: "plate" }, h("div", { class: "plate-head" },
      h("p", { class: "eyebrow", text: "Aparat" }), h("h2", { class: "plate-title", text: "Brak podglądu aparatu" }), h("p", { class: "plate-desc", text: msg }),
      h("div", { class: "row-actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => els.camInput.click() }, "Zrób zdjęcie aparatem systemowym")))));
  }

  function renderIntro() {
    setResult(h("article", { class: "plate" },
      h("div", { class: "plate-head" },
        h("p", { class: "eyebrow", text: "Jak to działa" }),
        h("h2", { class: "plate-title", text: "Jedno zdjęcie — pełna ocena" }),
        h("p", { class: "plate-desc", text: "Telefon rozpozna typ i markę, oszacuje mechanizm z procentem pewności i oceni odporność. Zbliżenie otworu na klucz albo zdjęcie klucza podnosi pewność." })),
      h("div", { class: "plate-body" },
        h("ul", { class: "ticks check" },
          h("li", { text: "1. Cała kłódka w kadrze → typ, marka, materiał." }),
          h("li", { text: "2. Zbliżenie otworu na klucz → mechanizm." }),
          h("li", { text: "3. Klucz (jeśli jest) → potwierdzenie." }),
          h("li", { text: "Zdjęcia nie są zapisywane: po analizie znikają z pamięci." })))));
  }

  /* ======================= Copy ======================= */

  function resultText(est, S) {
    const T = KB.TYPE_BY_ID[est.type.id] || KB.OTHER_TYPE, B = est.brand.id && KB.BRAND_BY_ID[est.brand.id], M = KB.MECH_BY_ID[est.mech.id];
    const R = ratings(est, S.marks), L = [];
    L.push(T.title + (B ? " " + B.name : ""));
    L.push("Mechanizm: " + M.name + " (" + M.en + ")" + (est.mech.src === "user" ? ", potwierdzony" : ", pewność " + pct(est.mech.p)));
    if (est.mech.src !== "user" && est.mech.alts.length) L.push("Inne możliwości: " + est.mech.alts.map(([m, p]) => KB.MECH_BY_ID[m].name.toLowerCase() + " " + pct(p)).join(", "));
    L.push("Po czym poznać: " + lower1(M.key) + "; otwór: " + lower1(M.hole) + ".");
    L.push("Odporność: " + R.overall + "/5 (" + KB.LEVELS[R.overall].name + "); przecięcie " + R.cut + "/5, uderzenie " + R.impact + "/5, mechanizm " + R.mech + "/5, pogoda " + R.weather + "/5");
    const c = careItems(est).slice(0, 2);
    if (c.length) { L.push(""); c.forEach((x) => L.push("• " + x.n + ": " + x.d)); }
    L.push("");
    L.push("Ustalone w aplikacji „Jaka to kłódka?” na telefonie.");
    return L.join("\n");
  }
  function copyResult(est, S) {
    const text = resultText(est, S);
    let p;
    try { p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard")); } catch (e) { p = Promise.reject(e); }
    p.then(() => toast("Skopiowano opis"), () => {
      let box = $("copyBox");
      if (!box) { box = h("textarea", { id: "copyBox", class: "copy-box", readonly: true, rows: "9", "aria-label": "Opis do skopiowania" }); (els.result.querySelector(".plate-body") || els.result).append(box); }
      box.value = text; box.focus(); box.select();
      toast("Tekst jest zaznaczony. Skopiuj go z menu.");
    });
  }

  /* ======================= History (text only, this device) ======================= */

  const HKEY = "jaka-to-klodka/historia/v4", OLD_HKEY = "jaka-to-klodka/historia/v3";
  function cleanMarks(x) {
    x = x && typeof x === "object" ? x : {};
    const m = {};
    if (x.hardened === true) m.hardened = true;
    if (x.boron === true) m.boron = true;
    if ([1, 2, 3, 4, 5, 6].includes(x.cen)) m.cen = x.cen;
    if (KB.SS[x.ss]) m.ss = x.ss;
    if (Number.isInteger(x.width) && x.width >= 10 && x.width <= 150) m.width = x.width;
    return m;
  }
  function cleanEntry(e) {
    if (!e || typeof e.id !== "string" || !KB.TYPE_BY_ID[e.typ] || !KB.MECH_BY_ID[e.mech]) return null;
    const num = (v) => (typeof v === "number" && isFinite(v) ? clamp(v, 0, 1) : 0);
    return {
      id: e.id.slice(0, 40), ts: Number(e.ts) || Date.now(), typ: e.typ, typP: num(e.typP), typSrc: e.typSrc === "user" ? "user" : "foto",
      mech: e.mech, mechP: num(e.mechP), mechSrc: e.mechSrc === "user" ? "user" : "foto",
      alts: Array.isArray(e.alts) ? e.alts.filter((a) => Array.isArray(a) && KB.MECH_BY_ID[a[0]]).slice(0, 3).map((a) => [a[0], num(a[1])]) : [],
      brand: KB.BRAND_BY_ID[e.brand] ? e.brand : null, material: KB.MAT_BY_ID[e.material] ? e.material : null,
      marks: cleanMarks(e.marks), n: Number.isInteger(e.n) ? clamp(e.n, 0, 99) : 0
    };
  }
  function migrateOld() {
    // The previous version kept a photo thumbnail per entry. Keep the text, destroy the pictures.
    const old = store.get(OLD_HKEY, null);
    if (old == null) return [];
    store.del(OLD_HKEY);
    if (!Array.isArray(old)) return [];
    return old.map((e) => {
      const a = (e && e.answers) || {};
      const typ = KB.TYPE_BY_ID[a.typ] ? a.typ : null;
      if (!typ) return null;
      const T = KB.TYPE_BY_ID[typ];
      const mech = KB.MECH_BY_ID[a.mech] ? a.mech : T.id === "szyfrowa_kolka" || T.id === "tsa" ? "kola" : T.id === "szyfrowa_tarcza" ? "tarcza_szyfrowa" : T.id === "elektroniczna" ? "elektroniczny" : "bebenkowy";
      return cleanEntry({ id: String(e.id || ("m" + Math.random())), ts: e.ts, typ, typP: 1, typSrc: "user", mech, mechP: KB.MECH_BY_ID[a.mech] ? 1 : 0.6, mechSrc: KB.MECH_BY_ID[a.mech] ? "user" : "foto",
        material: a.material, marks: a, n: 0 });
    }).filter(Boolean);
  }
  let history = (() => {
    const cur = store.get(HKEY, []);
    const list = (Array.isArray(cur) ? cur : []).map(cleanEntry).filter(Boolean);
    const migrated = migrateOld();
    const all = list.concat(migrated.filter((m) => !list.some((x) => x.id === m.id))).sort((a, b) => b.ts - a.ts).slice(0, 30);
    if (migrated.length) store.set(HKEY, all);
    return all;
  })();
  function saveHistory(S, est) {
    if (!S.photos.length && !S.user.typ && !S.user.mech) return;
    const e = cleanEntry({ id: S.id, ts: S.ts, typ: est.type.id, typP: est.type.p, typSrc: est.type.src, mech: est.mech.id, mechP: est.mech.p, mechSrc: est.mech.src,
      alts: est.mech.alts, brand: est.brand.id, material: est.material.id, marks: S.marks, n: S.photos.length });
    if (!e) return;
    history = [e].concat(history.filter((x) => x.id !== e.id)).slice(0, 30);
    let arr = history;
    while (arr.length && !store.set(HKEY, arr)) arr = arr.slice(0, Math.floor(arr.length / 2));
    renderHist();
  }
  function estFromEntry(e) {
    const dist = {};
    KB.MECHS.forEach((m) => { dist[m.id] = 0; });
    dist[e.mech] = e.mechP;
    e.alts.forEach(([m, p]) => { dist[m] = p; });
    const tdist = {};
    KB.TYPES.forEach((t) => { tdist[t.id] = t.id === e.typ ? e.typP : 0; });
    return {
      type: { id: e.typ, p: e.typP, dist: tdist, src: e.typSrc }, material: { id: e.material, p: 1 }, brand: { id: e.brand, w: 1, src: "foto" },
      mech: { id: e.mech, p: e.mechP, dist, alts: e.alts, src: e.mechSrc, prior: dist }, seen: { front: 1, keyway: 1, key: 1 }, lockLike: 1, evidence: [], directCues: []
    };
  }
  function renderHistTools(confirming) {
    clear(els.histTools);
    if (!confirming) { els.histTools.append(h("button", { type: "button", class: "link-btn", onclick: () => renderHistTools(true) }, "Wyczyść")); return; }
    els.histTools.append(h("span", { class: "confirm-q", text: "Usunąć wszystko?" }),
      h("button", { type: "button", class: "link-btn danger", onclick: () => { history = []; store.del(HKEY); renderHist(); renderData(); } }, "Usuń"),
      h("button", { type: "button", class: "link-btn", onclick: () => renderHistTools(false) }, "Anuluj"));
  }
  function renderHist() {
    clear(els.histList);
    els.history.hidden = history.length === 0;
    history.forEach((e) => {
      const T = KB.TYPE_BY_ID[e.typ], M = KB.MECH_BY_ID[e.mech], B = e.brand && KB.BRAND_BY_ID[e.brand];
      const open = h("button", { type: "button", class: "hist-open", onclick: () => openHist(e.id) },
        h("span", { class: "ico", html: icon(T.icon) }),
        h("span", { class: "hist-text" }, h("strong", { text: T.name + (B ? " · " + B.name : "") }),
          h("span", { text: fmtDate(e.ts) + " · " + M.name.toLowerCase() + (e.mechSrc === "user" ? " ✓" : " " + pct(e.mechP)) })));
      const del = h("button", { type: "button", class: "icon-btn", "aria-label": "Usuń z historii: " + T.name, html: icon('<path d="M7 7l10 10M17 7L7 17"/>', "0 0 24 24"),
        onclick: () => { history = history.filter((x) => x.id !== e.id); store.set(HKEY, history); renderHist(); renderData(); } });
      els.histList.append(h("li", null, open, del));
    });
    renderHistTools(false);
    renderData();
  }
  function openHist(id) {
    if (state.busy) return;
    const e = history.find((x) => x.id === id);
    if (!e) return;
    const S = { id: e.id, ts: e.ts, photos: [], user: {}, marks: Object.assign({}, e.marks) };
    state.viewing = S;
    renderResult(estFromEntry(e), S, "history");
    $("scanner").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  }
  function startNew() {
    newSession();
    renderIntro();
    markGuide(null);
    focusCamera();
  }

  /* ======================= Guide, settings, status ======================= */

  function renderGuide() {
    KB.TYPES.forEach((t) => {
      els.types.append(h("li", { class: "type", "data-cat": t.id }, h("span", { class: "ico", html: icon(t.icon) }),
        h("div", null, h("h3", { text: t.name }), h("p", { text: t.desc }), h("span", { class: "range", text: "Odporność zwykle " + t.range + "/5" }))));
    });
    KB.MECHS.forEach((m) => {
      els.mechList.append(h("div", null, h("dt", null, m.name, h("small", { text: m.en })), h("dd", { text: m.key + ". Otwór: " + lower1(m.hole) + ". " + m.opis })));
    });
    Object.keys(KB.LEVELS).forEach((k) => {
      els.scaleList.append(h("div", null, h("dt", { text: k + "/5 · " + KB.LEVELS[k].name }), h("dd", { text: "Typowo: " + KB.LEVELS[k].uses + "." })));
    });
  }
  function markGuide(cat) {
    els.types.querySelectorAll(".type.is-match").forEach((li) => { li.classList.remove("is-match"); const c = li.querySelector(".match-chip"); if (c) c.remove(); });
    if (!cat || cat === "inna") return;
    const li = els.types.querySelector('.type[data-cat="' + cat + '"]');
    if (li) { li.classList.add("is-match"); li.querySelector("h3").append(h("span", { class: "match-chip", text: "Twoja" })); }
  }
  function renderData() {
    const kb = Math.round((store.size(HKEY) + store.size(LKEY)) * 2 / 1024);
    els.dataInfo.textContent = "Historia: " + history.length + " " + plural(history.length, "wpis", "wpisy", "wpisów") + " · nauka: " + Learn.items.length + " " + plural(Learn.items.length, "odcisk", "odciski", "odcisków") + " · ok. " + kb + " KB. Zdjęć: 0.";
    els.learnSwitch.setAttribute("aria-checked", String(settings.learn));
  }
  function renderModel(st) {
    const ms = els.modelStatus;
    ms.classList.toggle("ok", st.state === "ready");
    ms.classList.toggle("err", st.state === "error");
    const bar = els.modelBar.firstChild;
    if (st.state === "ready") { els.modelText.textContent = "Model gotowy · działa offline"; els.modelBar.hidden = true; }
    else if (st.state === "error") { els.modelText.textContent = "Nie udało się wczytać modelu — dotknij, aby ponowić"; els.modelBar.hidden = true; }
    else {
      els.modelBar.hidden = false;
      const p = st.total ? st.loaded / st.total : 0;
      bar.style.width = Math.round(p * 100) + "%";
      els.modelText.textContent = st.total && st.loaded < st.total
        ? "Pobieram model rozpoznawania (raz): " + Math.round(st.loaded / 1048576) + " z " + Math.round(st.total / 1048576) + " MB"
        : "Uruchamiam model rozpoznawania…";
      if (state.busy) finderMsg(st.total && st.loaded < st.total ? "Pobieram model: " + Math.round(p * 100) + "% — zdjęcie czeka w pamięci" : "Uruchamiam model…");
    }
    if (st.state === "ready") { updateFinder(); Auto.start(); }
  }

  /* ======================= Start ======================= */

  els.shutter.addEventListener("click", onShutter);
  els.finderTap.addEventListener("click", onShutter);
  els.galInput.addEventListener("change", () => onFile(els.galInput));
  els.camInput.addEventListener("change", () => onFile(els.camInput));
  els.newBtn.addEventListener("click", startNew);
  els.modelStatus.addEventListener("click", () => { if (Model.st.state === "error") Model.retry(); });
  els.learnSwitch.addEventListener("click", () => { settings.learn = !settings.learn; store.set(SKEY, settings); renderData(); });
  $("autoSwitch").addEventListener("click", () => {
    settings.auto = !(settings.auto !== false);
    store.set(SKEY, settings);
    $("autoSwitch").setAttribute("aria-checked", String(settings.auto));
    if (settings.auto) Auto.start(); else Auto.stop();
    updateFinder();
  });
  $("autoSwitch").setAttribute("aria-checked", String(settings.auto !== false));
  els.wipeBtn.addEventListener("click", () => {
    if (els.wipeBtn.dataset.confirm !== "1") { els.wipeBtn.dataset.confirm = "1"; els.wipeBtn.textContent = "Na pewno usunąć?"; setTimeout(() => { els.wipeBtn.dataset.confirm = ""; els.wipeBtn.textContent = "Usuń"; }, 4000); return; }
    history = []; store.del(HKEY); store.del(OLD_HKEY); Learn.clear();
    els.wipeBtn.dataset.confirm = ""; els.wipeBtn.textContent = "Usuń";
    renderHist(); renderData(); toast("Usunięto historię i naukę");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && Cam.live) Cam.stop(); });
  window.addEventListener("pagehide", () => { if (Cam.live) Cam.stop(); });
  Model.on(renderModel);
  Learn.load();
  renderGuide();
  renderHist();
  renderIntro();
  updateFinder();
  renderModel(Model.st);
  Model.start();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Test hook (no effect for users): lets automated tests feed an image without a camera.
  window.__klodka = { analyzeSource: (src) => { const W = src.width || src.naturalWidth, H = src.height || src.naturalHeight; const t = makeTensors(src, { x: 0, y: 0, w: W, h: H }); return analyze(t.pixels, t.q, "test"); },
    state, estimate: () => state.session && estimate(state.session), model: Model, learn: Learn,
    newSession: () => { newSession(); renderIntro(); updateFinder(); } };
})();
