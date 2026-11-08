// Aumente a versão a cada publicação para os aparelhos receberem os arquivos novos.
const CACHE = 'fitmonjaro-v8';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './logic.js',
  './app.js',
  './editor.js',
  './icons.js',
  './db.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: request.mode === 'navigate' })
      .then((hit) => hit ?? fetch(request).catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
