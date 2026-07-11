const CACHE = 'stella-v119';
const KEEP_CACHES = [CACHE, 'stella-talk-prefs'];   // prefs(알림모드/뮤트)는 업데이트 때 지우지 않음

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => KEEP_CACHES.indexOf(k) === -1).map(k => caches.delete(k)))
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

// 클라이언트가 알려주는 상태(카톡식 팝업 판단용). in-memory 는 SW 재시작 시 사라지므로
// 알림모드/뮤트는 Cache 에도 영속화 → 앱이 완전히 닫힌 상태의 콜드 스타트 푸시도 무음/뮤트를 존중.
let _talkCurrentRoom = '';   // 현재 사용자가 보고 있는 방 (앱 열려 있을 때만 의미 → 영속화 안 함)
let _talkMutes = {};         // 방별 알림 끔 { roomId: 1 }
let _talkNotifyMode = 'sound'; // 전역 알림 모드 sound/vibrate/silent — 무음이면 시스템 팝업 소리 억제
const PREFS_CACHE = 'stella-talk-prefs';
async function _prefsPut(key, val){ try{ const c=await caches.open(PREFS_CACHE); await c.put('/__pref/'+key, new Response(JSON.stringify(val))); }catch(e){} }
async function _prefsGet(key, fallback){ try{ const r=await caches.match('/__pref/'+key); if(r) return JSON.parse(await r.text()); }catch(e){} return fallback; }

self.addEventListener('push', e => {
  let data = { title: 'Stella Talk', body: '새 메시지가 있습니다.' };
  try { if (e.data) data = e.data.json(); } catch(err) {}
  const title = data.title ? ('Stella Talk · ' + data.title) : 'Stella Talk';
  e.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 열린 창에 즉시 전달 → 인앱 사운드(설정한 음성)/토스트/즉시 동기화 (폴링보다 빠름). senderId=자기수신 방어값.
    list.forEach(c => { try { c.postMessage({ type: 'PUSH_MESSAGE', roomId: data.roomId || '', senderId: data.senderId || '', title: data.title || '', body: data.body || '' }); } catch (err) {} });
    // 콜드 스타트 대비: in-memory 가 비어 있으면 영속값으로 복원.
    const mode = _talkNotifyMode || await _prefsGet('mode', 'sound');
    const mutes = (Object.keys(_talkMutes).length ? _talkMutes : await _prefsGet('mutes', {})) || {};
    // 카톡 동일: 그 방을 화면에 띄워 보고 있으면 시스템 팝업 생략. 방별 뮤트도 존중.
    const viewing = list.some(c => (c.visibilityState === 'visible') && _talkCurrentRoom && data.roomId && _talkCurrentRoom === data.roomId);
    if (viewing) return;
    if (data.roomId && mutes[data.roomId]) return;
    // ★무음 설정: 팝업(배너)은 그대로 띄우되 시스템 알림음/진동만 끈다(silent:true). 사운드/진동 모드는 기존대로.
    const silent = (mode === 'silent');
    await self.registration.showNotification(title, {
      body: data.body || '새 메시지',
      icon: '/icons/talk-192.png',
      badge: '/icons/talk-192.png',
      vibrate: silent ? [] : [200, 100, 200],
      silent: silent,
      tag: 'stella-talk-' + (data.roomId || 'msg'),   // 방별 스택(같은 방은 갱신, 다른 방은 별도 팝업)
      renotify: !silent,
      data: { url: data.url || '/talk', roomId: data.roomId || '' }
    });
  })());
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

// 클라이언트가 강제 업데이트 요청 시 + 카톡식 팝업 판단용 상태 수신
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'clearCache') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
  const d = e.data;
  if (d && typeof d === 'object') {
    if (d.type === 'CURRENT_ROOM') _talkCurrentRoom = d.roomId || '';
    if (d.type === 'MUTES') { _talkMutes = d.mutes || {}; e.waitUntil ? e.waitUntil(_prefsPut('mutes', _talkMutes)) : _prefsPut('mutes', _talkMutes); }
    if (d.type === 'NOTIFY_MODE') { _talkNotifyMode = d.mode || 'sound'; e.waitUntil ? e.waitUntil(_prefsPut('mode', _talkNotifyMode)) : _prefsPut('mode', _talkNotifyMode); }
    if (d.type === 'PUSH_CFG') { const cfg = { publicKey: d.publicKey || '', userId: d.userId || '' }; e.waitUntil ? e.waitUntil(_prefsPut('pushCfg', cfg)) : _prefsPut('pushCfg', cfg); }
  }
});

// ★브라우저가 푸시 구독을 회전/만료시키면(pushsubscriptionchange) 앱이 닫혀 있어도 SW가
//   저장해둔 VAPID 공개키·userId로 즉시 재구독 + 서버에 재등록 → 푸시가 조용히 죽지 않게 한다.
function _b64ToU8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const cfg = await _prefsGet('pushCfg', null);
      if (!cfg || !cfg.publicKey || !cfg.userId) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToU8(cfg.publicKey) });
      await fetch('/api/push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: cfg.userId, subscription: sub.toJSON ? sub.toJSON() : sub }) });
    } catch (err) { /* 다음 앱 실행 시 subscribePush 가 복구 */ }
  })());
});
