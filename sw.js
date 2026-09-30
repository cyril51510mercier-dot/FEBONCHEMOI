/**
 * SOLSTICE - SERVICE WORKER (V7.15)
 * Stratégie : Network-First + Purge Automatique des Caches Obsolètes
 */

const CACHE_NAME = 'solstice-v7.18'; // ⚡ Incremente uniquement ce numéro lors des mises à jour !

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

// 2. Activation & Purge automatique des anciens caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Suppression de l\'ancien cache :', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Prend le contrôle immédiat de tous les onglets ouverts
  );
});

// 3. Interception des requêtes : Réseau d'abord (Network-First), fallback Cache
self.addEventListener('fetch', (e) => {
  // On ne gère en cache que les requêtes GET locales (on ignore Supabase / API tierces)
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Si le réseau répond correctement, on met à jour le cache et on sert le fichier frais
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        // En cas de coupure réseau (hors-ligne), on bascule sur la version en cache
        return caches.match(e.request);
      })
  );
});
