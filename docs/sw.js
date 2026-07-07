/* Service worker — offline-first app shell.
   Everything the app needs is precached, so the whole guide, progress tracking,
   camera capture, and stored photos work with NO network. The only thing that
   needs the internet is the Claude helper's call to api.anthropic.com, which is
   always fetched live and never cached. */
const CACHE = "crv-s1-v15";
const SHELL = [
  "./",
  "./index.html",
  "./marketplace.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // addAll fails the whole install if any file 404s; add individually so a
      // missing optional icon never blocks offline capability.
      Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Never intercept the Claude API (or any cross-origin request) — always live network.
  if (url.origin !== self.location.origin) return;
  if (req.method !== "GET") return;

  // Navigations: NETWORK-FIRST for the app shell so an online user always gets the
  // latest index.html (and we refresh the cache); fall back to the cached shell only
  // when offline. This prevents users getting stuck on a stale/broken cached shell.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); }
        return res;
      }).catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Same-origin assets: cache-first, fall back to network, then cache the result.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit)
    )
  );
});
