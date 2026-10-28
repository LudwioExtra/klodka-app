/* Service worker: offline app shell + model cache.
   - SHELL is versioned: bump it with every release so phones pick up the new files.
   - MODEL holds the ~90 MB recognition model and the 14 MB runtime (the vision worker stores them there
     itself); it survives app updates and changes name only when the model version changes.
   - Only the app's own files are ever cached (whitelist). Photos never pass through here: the camera
     frame goes straight from the video element to memory, and a gallery file is read locally. */
const SHELL = "klodka-shell-v8";
const MODEL = "klodka-model-b32-int8-1";
const SHELL_ASSETS = [
  "./", "./index.html", "./app.js", "./kb.js", "./vision-worker.js", "./manifest.webmanifest",
  "./ort/ort.wasm.bundle.min.mjs",
  "./fonts/fonts.css",
  "./fonts/archivo-latin-400-normal.woff2", "./fonts/archivo-latin-ext-400-normal.woff2",
  "./fonts/archivo-latin-500-normal.woff2", "./fonts/archivo-latin-ext-500-normal.woff2",
  "./fonts/archivo-latin-600-normal.woff2", "./fonts/archivo-latin-ext-600-normal.woff2",
  "./fonts/archivo-latin-700-normal.woff2", "./fonts/archivo-latin-ext-700-normal.woff2",
  "./fonts/ibm-plex-mono-latin-400-normal.woff2", "./fonts/ibm-plex-mono-latin-ext-400-normal.woff2",
  "./fonts/ibm-plex-mono-latin-500-normal.woff2", "./fonts/ibm-plex-mono-latin-ext-500-normal.woff2",
  "./fonts/ibm-plex-mono-latin-600-normal.woff2", "./fonts/ibm-plex-mono-latin-ext-600-normal.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png", "./icons/icon-180.png", "./icons/favicon-32.png"
];
const scope = new URL("./", self.location.href).pathname;
const rel = (u) => (u.pathname.startsWith(scope) ? u.pathname.slice(scope.length) : null);
const BIG = /^(model\/(?!model\.json$)[\w.-]+|ort\/ort-wasm-simd-threaded\.wasm)$/;
const FRESH = /^model\/model\.json$/;
const APP = /^(|index\.html|app\.js|kb\.js|vision-worker\.js|manifest\.webmanifest|ort\/ort\.wasm\.bundle\.min\.mjs|fonts\/[\w.-]+\.(css|woff2)|icons\/[\w.-]+\.png)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== MODEL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(cacheName, req, res) {
  if (!res || !res.ok || res.type !== "basic") return res;
  const copy = res.clone();
  caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.headers.has("range")) return;
  const path = rel(url);
  if (path == null) return;

  if (BIG.test(path)) {
    e.respondWith(caches.open(MODEL).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => put(MODEL, req, res)))));
    return;
  }
  if (FRESH.test(path)) {
    e.respondWith(fetch(req).then((res) => put(MODEL, req, res)).catch(() => caches.open(MODEL).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || Response.error())));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./index.html").then((hit) => hit || fetch(req)).catch(() => fetch(req)));
    return;
  }
  if (APP.test(path)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => put(SHELL, req, res))));
  }
  // Anything else is not the app's own file: let the browser handle it, never cache it.
});
