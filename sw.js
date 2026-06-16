const CACHE = 'stella-v6';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', e => {
  let data = { title: 'Stella Talk', body: '새 메시지가 있습니다.' };
  try { if (e.data) data = e.data.json(); } catch(err) {}
  e.waitUntil(
    self.registration.showNotification('Stella Talk', {
      body: data.body || '새 메시지',
      icon: '/icons/talk-192.png',
      badge: '/icons/talk-192.png',
      vibrate: [200, 100, 200],
      tag: 'stella-talk-msg',
      renotify: true,
      data: { url: data.url || '/talk' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/talk';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.includes('/talk') && 'focus' in list[i]) return list[i].focus();
      }
      return clients.openWindow(url);
    })
  );
});
