self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function reuseWindow(client, payload, target) {
  let received = false;
  try {
    const channel = new MessageChannel();
    const receipt = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 1200);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
    client.postMessage(payload, [channel.port2]);
    try { await client.focus(); } catch (_) {}
    received = await receipt;
  } catch (_) {}
  if (received) return true;
  try {
    const navigated = await client.navigate(target);
    if (!navigated) return false;
    try { await navigated.focus(); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

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
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/journal', self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== '/journal') return;
    const notificationId = event.notification.data?.notification_id;
    if (Number.isSafeInteger(notificationId) && notificationId > 0) {
      target.searchParams.set('notification_id', String(notificationId));
    }
    const payload = {
      type: 'open-journal-record', url: target.pathname + target.search,
      recordId: Number(target.searchParams.get('record_id')),
      notificationId,
    };
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const journal = windows.find((client) => {
      const path = new URL(client.url).pathname;
      return path === '/journal' || path.startsWith('/journal/');
    }) || windows.find((client) => {
      const path = new URL(client.url).pathname;
      return path === '/login' || path === '/';
    });
    if (journal) {
      await reuseWindow(journal, payload, target.href);
      return;
    }
    let opened = null;
    try { opened = await self.clients.openWindow(target.href); } catch (_) {}
    if (opened) await opened.focus();
  })());
});
