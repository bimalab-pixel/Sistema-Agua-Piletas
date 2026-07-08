// ============================================================
//  Service Worker - ACOMAACAP PWA
//  Cachea el "app shell" para que index.html y caja.html
//  funcionen sin conexión. Sube CACHE_VERSION cuando cambies
//  los archivos para forzar la actualización en los teléfonos.
// ============================================================

const CACHE_VERSION = 'acomaacap-v9-8';
const CACHE_NAME = `acomaacap-cache-${CACHE_VERSION}`;

// Archivos del "app shell" que se guardan de entrada.
const APP_SHELL = [
    './',
    './index.html',
    './caja.html',
    './offline.html',
    './manifest.json',
    './html2pdf.bundle.min.js',
    './icons/icon-48.png',
    './icons/icon-72.png',
    './icons/icon-96.png',
    './icons/icon-144.png',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// ----- INSTALACIÓN: precachea el app shell -----
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// ----- ACTIVACIÓN: borra cachés viejas de versiones anteriores -----
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key.startsWith('acomaacap-cache-') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// ----- FETCH -----
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Solo manejamos peticiones GET.
    if (req.method !== 'GET') return;

    // Recursos del mismo origen (app shell, íconos, html2pdf, etc.):
    // Cache First, y se actualiza la caché en segundo plano (stale-while-revalidate).
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                const fetchPromise = fetch(req).then((networkRes) => {
                    if (networkRes && networkRes.status === 200) {
                        const clone = networkRes.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                    }
                    return networkRes;
                }).catch(() => cached);

                return cached || fetchPromise;
            }).catch(() => {
                // Si es una navegación (el usuario abrió la app) y todo falla, mostrar offline.html
                if (req.mode === 'navigate') {
                    return caches.match('./offline.html');
                }
            })
        );
        return;
    }

    // Recursos externos (Firebase, Google APIs, etc.):
    // Network First, con respaldo de caché si ya se habían usado antes.
    event.respondWith(
        fetch(req)
            .then((networkRes) => {
                if (networkRes && networkRes.status === 200) {
                    const clone = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                }
                return networkRes;
            })
            .catch(() => caches.match(req))
    );
});
