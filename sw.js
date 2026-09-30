/**
 * SOLSTICE - SERVICE WORKER (V7.1)
 * Stratégie : Network-First + Purge Automatique des Caches Obsolètes
 */

const CACHE_NAME = 'solstice-v7.9'; // ⚡ Pense à incrémenter ce numéro lors de grosses mises à jour

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

// 1. Installation & Prise en charge immédiate (skipWaiting)
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Forcer le nouveau Service Worker à devenir actif sans attendre
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 2. Activation & Purge des anciens caches (solstice-v6, solstice-v5, etc.)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Suppression de l'ancien cache :', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Prendre le contrôle immédiat de tous les onglets/PWA ouverts
  );
});

// 3. Stratégie Fetch : Network-First (Tenter le réseau, sinon basculer sur le cache)
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Ignorer les requêtes d'API externes et Supabase (toujours en direct sur le réseau)
  if (
    e.request.method !== 'GET' ||
    url.includes('supabase.co') ||
    url.includes('openweathermap.org') ||
    url.includes('hook.eu1.make.com')
  ) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Si le réseau répond correctement, on met à jour le cache au passage
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // En cas de panne réseau / hors-ligne, on utilise le secours en cache
        return caches.match(e.request);
      })
  );
});
