const CACHE_NAME = 'solstice-v1';
const ASSETS = [
  './',
  './index.html',
  './setup.html',
  './reco.html',
  './style.css',
  './engine.js',
  './reco.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});