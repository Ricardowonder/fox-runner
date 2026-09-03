// Fox Runner service worker.
//
// Two caches:
//  - SHELL_CACHE (versioned): HTML/CSS/JS/manifest/icons. Bump SHELL_VERSION
//    when shipping code changes; the old shell cache is evicted on activate.
//  - ART_CACHE (stable): game art under assets/. Art files never change
//    content under the same name, so this cache survives shell bumps and
//    phones never re-download the artwork. Bump ART_VERSION only if an
//    asset's content actually changes under an existing filename.
const SHELL_VERSION = "v39";
const ART_VERSION = "v7";
const SHELL_CACHE = `fox-runner-shell-${SHELL_VERSION}`;
const ART_CACHE = `fox-runner-art-${ART_VERSION}`;
const KEEP = [SHELL_CACHE, ART_CACHE];

/* style.css is deliberately absent: it is requested with a ?v= stamp that
 * changes each release, so precaching the bare name would store a copy
 * nothing asks for - and, worse, one taken from the browser's own HTTP
 * cache, which is how a stale stylesheet used to survive a version bump.
 * The fetch handler caches it at runtime instead.
 */
const PRECACHE = [
  ".",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigations and game.js (so updates arrive when online),
// cache-first for everything else. Art goes in the stable art cache.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isArt = url.pathname.includes("/assets/");
  /* The shell files change with every release, so always try the network
   * for them: cache-first meant a CSS or manifest change only appeared a
   * reload after it shipped. The cache still covers offline play.
   */
  const networkFirst =
    request.mode === "navigate" ||
    /\.(?:js|css|webmanifest)$/.test(url.pathname);

  if (networkFirst) {
    // no-store so iOS's own HTTP cache cannot hand back a stale shell that
    // points at renamed assets; the cache below still covers offline use.
    const fresh = request.mode === "navigate"
      ? fetch(request.url, { cache: "no-store" })
      : fetch(request);
    event.respondWith(
      fresh
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: request.mode === "navigate" }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(isArt ? ART_CACHE : SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
