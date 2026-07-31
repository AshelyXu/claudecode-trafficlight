const CACHE = 'claude-monitor-v2';

// On install, immediately take control
self.addEventListener('install', () => {
  self.skipWaiting();
});

// On activate, purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// Network-first for HTML, cache-first for other static assets
self.addEventListener('fetch', (event) => {
  // Never intercept SSE stream
  if (event.request.url.includes('/api/stream')) return;

  // Network-first for HTML (always get latest)
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for other static assets
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, clone));
        return response;
      })
    )
  );
});
