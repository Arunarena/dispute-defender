// Service worker for the installable app. Pages and scripts load from the network first,
// with a cached copy as the offline fallback. API calls, tag pages and uploads are never cached:
// dispute data must always be live.
const CACHE = "defender-v3";
const SHELL = ["/", "/styles.css", "/app.js", "/views.js", "/copilot.js", "/nfc.js", "/theme.js", "/billboard.js", "/passkey.js", "/img/shield.svg", "/img/icon-192.png", "/img/app-icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || /^\/(api|t|uploads)\//.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone(); // copy now: the page will read the original body
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("/"))),
  );
});
