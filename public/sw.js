// Offline-first service worker for B4Call's static shell.
// API/proxy calls are never cached — only the app shell and static assets.
const CACHE = 'b4call-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/components.css',
  '/images/b4call-api.png',
  '/images/b4call-api_light.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept dynamic endpoints.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mock/')) return;

  // Cache-first for same-origin static assets; fall back to network, then cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'document' || request.destination === 'image' || url.pathname === '/manifest.webmanifest')) {
              const clone = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
