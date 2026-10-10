// Service Worker for ShareApp (Section 2, 4.6, 5)
// - Serves cached app shell
// - Serves streaming downloads on /__download/:id
// - Handles web share target POST requests

const CACHE_NAME = 'shareapp-v3';
const STREAM_STREAMS = new Map<string, ReadableStreamDefaultController>();

self.addEventListener('install', (event: any) => {
  (self as any).skipWaiting();
});

self.addEventListener('activate', (event: any) => {
  event.waitUntil((self as any).clients.claim());
});

self.addEventListener('message', (event: any) => {
  const { type, transferId, chunk, isEnd } = event.data || {};

  if (type === 'stream-chunk') {
    const controller = STREAM_STREAMS.get(transferId);
    if (controller) {
      if (chunk) controller.enqueue(new Uint8Array(chunk));
      if (isEnd) {
        controller.close();
        STREAM_STREAMS.delete(transferId);
      }
    }
  }
});

self.addEventListener('fetch', (event: any) => {
  const url = new URL(event.request.url);

  // Streaming download route (Section 4.6)
  if (url.pathname.startsWith('/__download/')) {
    const transferId = url.pathname.replace('/__download/', '');
    const filename = url.searchParams.get('filename') || 'download';
    const stream = new ReadableStream({
      start(controller) {
        STREAM_STREAMS.set(transferId, controller);
      },
      cancel() {
        STREAM_STREAMS.delete(transferId);
      },
    });

    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store, no-cache',
    });

    event.respondWith(new Response(stream, { headers }));
    return;
  }

  // Web Share Target handler (Section 5)
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const files = formData.getAll('files');
        // Redirect to main app screen
        return Response.redirect('/?shared=true', 303);
      })()
    );
    return;
  }

  // Default network-first or cache strategy for static assets
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
