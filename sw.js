// MEP Quick Calcs — service worker
// Caches the calculator page + icons so it opens instantly and works offline
// once it's been loaded (and installed to a home screen) at least once.

const CACHE_NAME = 'mep-quick-calcs-v10';
const CACHE_URLS = [
  '/tools-calculator.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n.indexOf('mep-quick-calcs-') === 0 && n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Cache-first ONLY for the explicit app-shell files above (tools-calculator.html,
// manifest, icons) — these rarely change and benefit from instant/offline loading.
// Everything else on the site (tools.html, weather.html, index.html, etc.) goes
// network-first so edits show up immediately, falling back to cache only if the
// network request fails (e.g. offline).
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  var isAppShell = CACHE_URLS.some(function(path) {
    return event.request.url.indexOf(path) !== -1;
  });

  if (isAppShell) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, copy); });
          }
          return response;
        }).catch(function() {
          if (event.request.mode === 'navigate') return caches.match('/tools-calculator.html');
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});
