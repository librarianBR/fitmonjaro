// Aumente a versão a cada publicação para os aparelhos receberem os arquivos novos.
const CACHE = 'fitmonjaro-v10';
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
  // "reload" evita guardar arquivos antigos que ainda estejam no cache HTTP do navegador.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => caches.keys())
    // As versões até a 8 não têm o aviso de atualização: quem vem delas entra direto, uma única vez.
    .then((keys) => (keys.some((k) => /^fitmonjaro-v[1-8]$/.test(k)) ? self.skipWaiting() : undefined)));
});

// A versão nova espera aqui até a pessoa tocar em Atualizar.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
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
