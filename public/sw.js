/* Push-only service worker: shows order-status notifications, opens the
   tracking link on tap. Deliberately NO fetch handler — this worker must
   never cache or interfere with the site. */
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
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/assets/pan-icon-yellow-192.webp',
      badge: '/assets/pan-icon-yellow-192.webp',
      data: { url },
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
