// sw.js (Service Worker)
// ----------------------
// Offline-first app shell caching.
//
// IMPORTANT: Do NOT cache ad network requests.
// We only cache our own static files.

const CACHE_NAME = 'expense-guard-v3';

// The "app shell" files required to load the UI offline.
const ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './style.css',
  './app.js',
  './db.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  // Pre-cache core assets so the app can load offline.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean old caches when you bump CACHE_NAME.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests (our app files).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Serve cache first for speed + offline.
      if (cached) return cached;
      return fetch(event.request);
    })
  );
});
