/* Mog Share service worker — F5: offline shell, asset caching, share_target. */
const SHELL_CACHE = 'mog-shell-v3';
const SHARED_CACHE = 'mog-shared-files';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['./']).catch(() => undefined))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('mog-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // F5: Android share sheet → stash files, redirect into the app
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const files = formData.getAll('files');
          const cache = await caches.open(SHARED_CACHE);
          let i = 0;
          for (const file of files) {
            if (typeof file === 'string') continue;
            const headers = new Headers({
              'content-type': file.type || 'application/octet-stream',
              'x-file-name': encodeURIComponent(file.name || `shared-${i}`),
            });
            await cache.put(
              new Request(`/shared/${Date.now()}-${i++}`),
              new Response(await file.arrayBuffer(), { headers })
            );
          }
        } catch {
          /* ignore malformed shares */
        }
        return Response.redirect('/#shared', 303);
      })()
    );
    return;
  }

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never intercept API or WebSocket paths
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  // Navigations: network-first with offline shell fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('./').then((f) => f || Response.error())))
    );
    return;
  }

  // Hashed assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && url.pathname.startsWith('/assets/')) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy)).catch(() => undefined);
        }
        return res;
      });
    })
  );
});
