const CACHE = 'stella-v99';

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
  // API는 SW 개입 안 함
  if (url.pathname.startsWith('/api/')) return;

  // ★ HTML 문서 + 루트 경로는 항상 네트워크 우선 (최신 버전 보장)
  const isHTML = e.request.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname === '/'
    || url.pathname === '/talk'
    || url.pathname === '/db'
    || url.pathname === '/cc'
    || url.pathname === '/codex'
    || url.pathname === '/abap'
    || url.pathname === '/hub'
    || url.pathname === '/gpt';

  if (isHTML) {
    // 네트워크 우선 - 실패 시에만 캐시
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 그 외(아이콘, 이미지 등)는 캐시 우선 + 백그라운드 갱신
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('push', e => {
  let data = { title: 'Stella Talk', body: '새 메시지가 있습니다.' };
  try { if (e.data) data = e.data.json(); } catch(err) {}
  const title = data.title ? ('Stella Talk · ' + data.title) : 'Stella Talk';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '새 메시지',
      icon: '/icons/talk-192.png',
      badge: '/icons/talk-192.png',
      vibrate: [200, 100, 200],
      tag: 'stella-talk-msg',
      renotify: true,
      data: { url: data.url || '/talk', roomId: data.roomId || '' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = data.url || '/talk';
  const roomId = data.roomId || '';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.includes('/talk') && 'focus' in c) {
          if (roomId) { try { c.postMessage({ type: 'OPEN_ROOM', roomId: roomId }); } catch (err) {} }   // STAGE 6: 딥링크
          return c.focus();
        }
      }
      return clients.openWindow(url);   // 없으면 /talk?room=X 새로 열기
    })
  );
});

// STAGE 6: 주기적 백그라운드 동기화(지원 시). 열린 탭에 동기화 트리거 전달.
//   앱이 완전히 종료된 상태의 백그라운드 수신은 서버 Web Push 구독(VAPID)이 정석 → 다음 단계.
self.addEventListener('periodicsync', e => {
  if (e.tag === 'talk-sync') {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        list.forEach(function (c) { try { c.postMessage({ type: 'PERIODIC_SYNC' }); } catch (err) {} });
      })
    );
  }
});

// 클라이언트가 강제 업데이트 요청 시
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'clearCache') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
