/**
 * hackboard service worker.
 *
 * Two caching strategies, because the two kinds of asset have opposite requirements:
 *
 *   App shell (HTML, hashed JS/CSS, icons) -- cache-first. Vite fingerprints these filenames,
 *   so a cached one is immutable and can be served without touching the network.
 *
 *   Data (data/*.json) -- stale-while-revalidate. Show yesterday's hackathons instantly, then
 *   quietly replace them. Opening this on the Metro with no signal must show a list, not a
 *   dinosaur, and the UI states honestly how old the list is.
 *
 * Cache versioning is not optional. VERSION is stamped at build time, so a deploy creates a
 * new cache and the activate step deletes every older one -- without that, a returning visitor
 * is served last month's bundle forever.
 */
const VERSION = "__BUILD__";
const SHELL = `hackboard-shell-${VERSION}`;
const DATA = `hackboard-data-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;

// Only the entry point is precached. Hashed asset names aren't known here, and hardcoding them
// is how a service worker starts serving a bundle that no longer exists.
const PRECACHE = [SCOPE, `${SCOPE}index.html`, `${SCOPE}manifest.webmanifest`,
                  `${SCOPE}icons/icon-192.png`, `${SCOPE}icons/icon-512.png`];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll fails the whole install if any single request 404s, which would leave the app
    // permanently un-installable over one stale path.
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("hackboard-") && !key.endsWith(VERSION))
          .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  // Cached first if there is one; otherwise wait for the network and fail honestly.
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return new Response(JSON.stringify({ last_updated: null, events: [], offline: true }), {
    status: 503, headers: { "Content-Type": "application/json" },
  });
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // A navigation that misses the cache while offline still has to render something, so fall
    // back to the shell and let the app show its own offline state.
    if (request.mode === "navigate") {
      const shell = await cache.match(`${SCOPE}index.html`);
      if (shell) return shell;
    }
    throw new Error("offline and not cached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;  // fonts and anything else: leave to the browser

  if (url.pathname.includes("/data/")) {
    event.respondWith(staleWhileRevalidate(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
