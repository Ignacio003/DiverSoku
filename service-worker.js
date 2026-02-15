/**
 * ============================================
 * SUDOKU - Service Worker
 * Handles caching for offline functionality
 * ============================================
 */

const CACHE_NAME = 'diversoku-cache-v4';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/sudoku-engine.js',
    '/puzzle-worker.js',
    '/script.js',
    '/manifest.json'
];

/**
 * Install event - Cache all static assets
 */
self.addEventListener('install', event => {
    console.log('[Service Worker] Installing...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Caching app shell...');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('[Service Worker] App shell cached successfully');
                return self.skipWaiting();
            })
            .catch(err => {
                console.error('[Service Worker] Cache failed:', err);
            })
    );
});

/**
 * Activate event - Clean up old caches
 */
self.addEventListener('activate', event => {
    console.log('[Service Worker] Activating...');

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(cacheName => cacheName !== CACHE_NAME)
                        .map(cacheName => {
                            console.log('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        })
                );
            })
            .then(() => {
                console.log('[Service Worker] Now ready to handle fetches');
                return self.clients.claim();
            })
    );
});

/**
 * Fetch event - Serve from cache, fallback to network
 * Uses Cache First strategy for performance
 */
self.addEventListener('fetch', event => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // Return cached version if available
                if (cachedResponse) {
                    // Fetch update in background (stale-while-revalidate)
                    event.waitUntil(
                        fetch(event.request)
                            .then(networkResponse => {
                                if (networkResponse && networkResponse.status === 200) {
                                    return caches.open(CACHE_NAME)
                                        .then(cache => cache.put(event.request, networkResponse));
                                }
                            })
                            .catch(() => { })
                    );
                    return cachedResponse;
                }

                // Not in cache, fetch from network
                return fetch(event.request)
                    .then(networkResponse => {
                        // Don't cache non-successful responses
                        if (!networkResponse || networkResponse.status !== 200) {
                            return networkResponse;
                        }

                        // Clone the response (response can only be consumed once)
                        const responseClone = networkResponse.clone();

                        // Add to cache
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, responseClone));

                        return networkResponse;
                    })
                    .catch(error => {
                        console.error('[Service Worker] Fetch failed:', error);

                        // Return offline fallback for navigation requests
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }

                        throw error;
                    });
            })
    );
});

/**
 * Handle messages from the main thread
 */
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => caches.delete(cacheName))
            );
        });
    }
});

/**
 * Background sync for future features (e.g., leaderboards)
 */
self.addEventListener('sync', event => {
    if (event.tag === 'sync-stats') {
        console.log('[Service Worker] Syncing stats...');
        // Future: Sync statistics with server
    }
});
