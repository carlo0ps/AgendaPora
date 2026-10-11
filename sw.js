const CACHE_NAME = 'mis-clientas-shell-v1';
const SHELL = ['./', './index.html', './admin.html', './reservar.html', './offline.html', './manifest.json', './css/style.css', './js/config.js', './js/utils.js', './js/app.js', './js/admin.js', './js/reservar.js', './icons/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, including public RPC, always stays on the network.
  if (url.pathname.includes('/rest/') || url.pathname.includes('/auth/') || url.pathname.includes('/storage/')) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && (request.mode === 'navigate' || SHELL.some(path => url.pathname.endsWith(path.replace('./',''))))) {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(async () => request.mode === 'navigate' ? (await caches.match('./offline.html')) || Response.error() : (await caches.match(request)) || Response.error()));
});
