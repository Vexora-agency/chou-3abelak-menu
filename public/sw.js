/* Push + app-shell cache. Push handlers show order notifications; the
   fetch handler ONLY accelerates repeat opens (cache-first for hashed
   /assets/* — a new deploy is new filenames, so staleness is impossible).
   index.html, /api/* and routes always go to network: never cached here. */
const ASSET_CACHE = 'app-assets-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(ASSET_CACHE);
      // Warm the notification icon so the first alert renders instantly.
      await cache.addAll(['/assets/pan-icon-yellow-192.webp']);
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== ASSET_CACHE).map((k) => caches.delete(k)));
    } catch (e) {}
    try {
      await self.clients.claim();
    } catch (e) {}
  })());
});

self.addEventListener('fetch', (event) => {
  let u;
  try {
    u = new URL(event.request.url);
  } catch (e) {
    return;
  }
  if (event.request.method !== 'GET' || u.origin !== self.location.origin) return;
  if (!u.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    try {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res && res.ok) {
        try {
          await cache.put(event.request, res.clone());
        } catch (e) {}
      }
      return res;
    } catch (e) {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      throw e;
    }
  })());
});
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {}
  const title = typeof data.title === 'string' && data.title ? data.title : 'New update';
  const body = typeof data.body === 'string' ? data.body : '';
  const url = typeof data.url === 'string' && data.url ? data.url : '/';
  // Every push MUST show a notification: silent pushes get the subscription
  // revoked (Safari rule), so there is no silent path here by design.
  // Stable tag groups an order's re-pushes into ONE persistent banner;
  // renotify re-blips the OS sound instead of stacking silently. vibrate is
  // Android-only (iOS ignores it) and harmless elsewhere.
  const tag = typeof data.tag === 'string' && data.tag ? data.tag.slice(0, 64) : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/assets/pan-icon-yellow-192.webp',
      badge: '/assets/pan-icon-yellow-192.webp',
      data: { url },
      tag,
      renotify: tag ? true : undefined,
      vibrate: [200, 100, 200, 100, 500],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const url = typeof raw === 'string' && raw ? raw : '/';
  event.waitUntil((async () => {
    const target = new URL(url, self.location.origin).href;
    // Reuse an open tab when it already shows the destination (kitchen
    // tapping ten notifications must not open ten admin tabs).
    try {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (c.url === target) {
          await c.focus();
          return;
        }
      }
      for (const c of all) {
        if (url.includes('/admin') && c.url.includes('/admin')) {
          await c.focus();
          return;
        }
        if (url.includes('track=') && c.url.includes('track=')) {
          await c.focus();
          return;
        }
      }
    } catch (e) {}
    await self.clients.openWindow(target);
  })());
});
