// 다람쥐 택시 Service Worker
// 웹 푸시 수신 + 알림 클릭 처리

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: '다람쥐 택시', body: event.data ? event.data.text() : '새 알림' };
  }

  const title = payload.title || '다람쥐 택시';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    tag: payload.tag || 'daramjwi-notify',
    data: { url: payload.url || '/' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // 이미 다람쥐 택시 탭이 열려있으면 포커스
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          if (client.navigate) {
            try { await client.navigate(targetUrl); } catch (e) {}
          }
          return;
        }
      }
      // 없으면 새 창
      await self.clients.openWindow(targetUrl);
    })()
  );
});
