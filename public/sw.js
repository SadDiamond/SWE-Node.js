// Keeps a copy of the site's files so it still opens without a connection.
// Endless can then be played offline. Everything else needs the server.
const CACHE = 'close-enough-v1';
const FILES = [
  '/', '/endless.html', '/past.html', '/history.html', '/stats.html', '/account.html',
  '/styles.css', '/app.js', '/graph.js', '/theme.js', '/curves.js', '/katex/katex.min.js',
  '/fonts/patrick-hand.woff2', '/fonts/nunito-400.woff2', '/fonts/nunito-600.woff2', '/fonts/nunito-700.woff2', '/icon.svg', '/icon-dark.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable.png',
  '/apple-touch-icon.png', '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});

// Online, the newest copy of a file is used and kept for later. Offline, the kept copy is used.
// Answers from the server are never kept, so scores and curves are always up to date.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: true })
      .then((kept) => kept || caches.match('/'))));
});
