const CACHE_VERSION = 'mis-clientas-shell-v9';
const SHELL = [
  './', './index.html', './admin.html', './reservar.html', './offline.html',
  './manifest.json', './css/style.css', './js/config.js', './js/utils.js',
  './js/app.js', './js/admin.js', './js/reservar.js', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('mis-clientas-shell-') && key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(request, url) {
  if (request.mode === 'navigate') return true;
  const path = url.pathname;
  return /\/(index\.html|admin\.html|reservar\.html|manifest\.json)$/.test(path)
    || /\/(js|css)\/[^/]+\.(js|css)$/.test(path);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Requests to Supabase (Auth, REST, RPC, Storage) always go straight to the network.
  if (/\.supabase\.co$/i.test(url.hostname)
    || /\/(auth|rest|storage)\//i.test(url.pathname)
    || url.origin !== self.location.origin) return;
  if (!isAppShellRequest(request, url)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok && response.type !== 'opaque') {
        const cache = await caches.open(CACHE_VERSION);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return (await caches.match('./offline.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
