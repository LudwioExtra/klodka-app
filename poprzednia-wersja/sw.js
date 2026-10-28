/* Service worker: app shell + model cached for offline use. Bump CACHE on each release. */
const CACHE = "klodka-v7";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./mobilenet.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-512-maskable.png", "./icons/icon-180.png", "./icons/favicon-32.png"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      try { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } catch (_) {}
      return res;
    }).catch(() => (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
