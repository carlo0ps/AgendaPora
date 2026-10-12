const RELOAD_PARAM = '__agendapora_worker_retired';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map(key => caches.delete(key).catch(() => false)));
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
    await self.registration.unregister().catch(() => false);
    await Promise.all(clients.map(client => {
      const url = new URL(client.url);
      if (url.origin !== self.location.origin || url.searchParams.get(RELOAD_PARAM) === '1') return null;
      url.searchParams.set(RELOAD_PARAM, '1');
      return client.navigate(url.href).catch(() => null);
    }));
  })());
});
