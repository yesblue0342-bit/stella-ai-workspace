// Stella Talk Service Worker - 푸시 알림 + 캐시 관리
const CACHE = 'stella-v4';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// 캐시 (API 제외)
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

// ── 푸시 알림 처리 (showNotification 포함) ──
self.addEventListener('push', e => {
  let data = { title: 'Stella Talk', body: '새 메시지가 있습니다.' };
  try { if (e.data) data = e.data.json(); } catch(err) {}
  e.waitUntil(
    self.registration.showNotification('Stella Talk · ' + (data.title || ''), {
      body: data.body || '새 메시지',
      icon: '/icons/talk-192.png?v=3',
      badge: '/icons/talk-192.png?v=3',
      vibrate: [200, 100, 200],
      tag: 'stella-talk-msg',
      renotify: true,
      data: { url: data.url || '/talk' }
    })
  );
});

// ── showNotification (talk.html에서 직접 호출) ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/talk';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 이미 열린 탭이 있으면 포커스
      for (const client of list) {
        if (client.url.includes('/talk') && 'focus' in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭 열기
      return clients.openWindow(url);
    })
  );
});
