self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let item;
    try { item = event.data.json(); } catch (_) { return; }
    if (!item || item.version !== 1 || !Number.isSafeInteger(item.id) || !item.title) return;
    const target = new URL(item.url || '/journal', self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== '/journal') return;
    await self.registration.showNotification(item.title, {
      body: item.body || '',
      icon: item.icon || '/static/images/brand.png',
      badge: item.icon || '/static/images/brand.png',
      tag: 'omsa-' + item.id,
      requireInteraction: true,
      silent: false,
      actions: Array.isArray(item.actions) ? item.actions : [],
      data: { url: target.href, notification_id: item.id },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action && event.action !== 'open') return;
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/journal', self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== '/journal') return;
    const notificationId = event.notification.data?.notification_id;
    if (Number.isSafeInteger(notificationId) && notificationId > 0) {
      target.searchParams.set('notification_id', String(notificationId));
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const journal = windows.find((client) => new URL(client.url).pathname === '/journal');
    if (journal) {
      await journal.navigate(target.href);
      await journal.focus();
    } else {
      await self.clients.openWindow(target.href);
    }
  })());
});
