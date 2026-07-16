/* =====================================================================
 * flkr — sw.js (Service Worker)
 * ---------------------------------------------------------------------
 * Strategy:
 *   - On install: precache CORE assets (HTML, CSS, JS, datasets).
 *   - On fetch (same-origin):    cache-first, then network, with
 *                                 a stale-while-revalidate background refresh.
 *   - On fetch (cross-origin,    network-first, fallback to cache, then
 *    e.g. picsum.photos):        a deterministic gradient placeholder.
 *   - On fetch (picsum images):  cache the response so subsequent loads
 *                                 work fully offline.
 * ===================================================================== */

var CACHE_VERSION = 'flkr-v1';
var CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/facts.js',
  './data/ads.js',
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll fails atomically if any request fails, so we add core
      // assets individually and tolerate failures (e.g. when running
      // from a non-root path during dev).
      return Promise.all(CORE_ASSETS.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('[sw] precache miss:', url, err.message);
        });
      }));
    }).then(function () {
      // Take over from the previous SW immediately so the user gets
      // offline support on the very first load.
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;

  // Only handle GET.
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Cross-origin image hosts (picsum.photos): network-first, cache the
  // response so it works offline next time. If both fail, return a
  // tiny SVG placeholder.
  if (url.origin !== self.location.origin) {
    if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(url.pathname)) {
      ev.respondWith(handleCrossOriginImage(req));
      return;
    }
    // Other cross-origin requests: just try the network, no caching.
    return;
  }

  // Same-origin: cache-first with background revalidation.
  ev.respondWith(
    caches.match(req).then(function (cached) {
      var fetcher = fetch(req).then(function (resp) {
        // Only cache successful responses.
        if (resp && resp.status === 200 && resp.type === 'basic') {
          var clone = resp.clone();
          caches.open(CACHE_VERSION).then(function (cache) {
            cache.put(req, clone).catch(function () {});
          });
        }
        return resp;
      }).catch(function () {
        // Network failed — fall back to cached if any.
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      });
      return cached || fetcher;
    })
  );
});

function handleCrossOriginImage(req) {
  return caches.open(CACHE_VERSION + '-img').then(function (cache) {
    return cache.match(req).then(function (cached) {
      var fetcher = fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          cache.put(req, clone).catch(function () {});
        }
        return resp;
      }).catch(function () {
        if (cached) return cached;
        return gradientPlaceholder();
      });
      return cached || fetcher;
    });
  });
}

// Build a 1×1 SVG with a soft dark gradient. Inline so we don't need a
// network round-trip to provide a fallback.
function gradientPlaceholder() {
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700" viewBox="0 0 600 700">' +
      '<defs>' +
        '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0"  stop-color="#2a1a3e"/>' +
          '<stop offset="0.5" stop-color="#1a3e4a"/>' +
          '<stop offset="1"  stop-color="#3e2a1a"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<rect width="600" height="700" fill="url(#g)"/>' +
      '<text x="50%" y="50%" font-family="sans-serif" font-size="48" fill="rgba(255,255,255,0.25)" text-anchor="middle">flkr</text>' +
    '</svg>';
  return new Response(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' },
  });
}

// Allow the page to trigger an immediate update.
self.addEventListener('message', function (ev) {
  if (ev.data === 'skipWaiting') self.skipWaiting();
});
