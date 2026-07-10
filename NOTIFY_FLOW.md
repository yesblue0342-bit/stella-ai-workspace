# Stella Talk — 알림 전체 흐름 (NOTIFY_FLOW)

> 기준: 2026-07-10 2차 무인 세션 **수정 전** 소스(talk.html, sw.js stella-v115).
> 이 문서가 회귀 방지의 기준선이다. 알림 관련 수정 시 이 흐름의 각 단계가 유지되는지 확인할 것.

## 0. 수신 채널 (메시지가 클라이언트에 도달하는 경로)

| 채널 | 함수/위치 | 주기 | 대상 |
|---|---|---|---|
| 방 목록 폴링 | `syncRoomListFromServer()` (initTalk에서 `setInterval` 3초) | 3s | **모든 방** (열지 않은 방 포함) |
| 현재 방 적응형 폴링 | `startPolling()` → `syncRoomFromServer(false)` | `pollDelay()`: 활성 1s / 유휴 2s / 롱폴건강 2.5s / 백그라운드 4s | 현재 열린 방(`_cur`) |
| 롱폴 실시간 채널 | `startLongPoll()` → `/api/chat-room-sse` (~25s 서버 대기) → `syncRoomFromServer(false)` | 즉시 | 현재 열린 방 |
| SW periodicsync | sw.js `periodicsync`(talk-sync, 15분) → 페이지에 `PERIODIC_SYNC` postMessage → `syncRoomListFromServer()` | ≥15min, 지원 브라우저 한정 | 모든 방 |
| Web Push | sw.js `push` → `showNotification` 직접 | 서버 발송 시 | VAPID 설정 시에만 (`/api/push-subscribe?action=key`가 `enabled:false`면 비활성) |

- 롱폴은 `_lastSyncAt[roomId]`(서버 기준 since)로 커서 관리, 실패 누적 시 `_lpHealthy=false` → 적응형 폴링이 안전망.
- **앱이 완전히 종료(모바일 PWA 킬)되면 폴링·롱폴 모두 정지** → Web Push 미설정 환경에서는 수신 자체가 없음(알림 불가, 구조적 한계).

## 1. 판정 단계 (수신 → 알림 여부 결정)

### 1-A. 현재 방 경로 — `syncRoomFromServer()` (talk.html ~1297)
새 메시지 순증가(`newCount>0`) 시:
1. `fromOther` 판정: `last.from`이 내 id/이름/이메일과 모두 다를 때만.
2. `markActivity()` → 1초 폴링 전환.
3. 스크롤: `scrollAfter || !fromOther || wasNearBottom` → `scrollBottom()`, 아니면 `showNewMsgChip(n)` (**과거 열람 중 강제 스크롤 금지**).
4. `fromOther`이면: `mentionsMe(text)` 판정 → `!isMuted(_cur.id) || 멘션` 일 때만
   - `playNotifySound(last.id)` (가시성 무관 — 보고 있는 방도 소리)
   - `document.hidden`일 때만 `notify(_cur.name, text, _cur.id)` (보고 있는 방은 팝업 생략)
5. `updateAppBadge()` — 뮤트여도 뱃지는 갱신.
6. 읽음: `document.visibilityState==='visible'`일 때만 `lastReadAt` 갱신 + `reportRead()` (**백그라운드 폴링이 상대 "1"을 지우지 않음** — FIX-LOCK [1]).

### 1-B. 방 목록 경로 — `syncRoomListFromServer()` (talk.html ~2983)
방마다 `lastMessageAt > _notifyLastAt[roomId]`(localStorage `stella_talk_notify_at` 영속) + `fromOtherRoom` + `!viewing`(현재 보이는 방 아님) 이면 `newRooms`에 수집.
- `_notifyPrimed`: **페이지 로드 후 첫 폴링은 baseline만 기록하고 알림하지 않음** (앱 열 때 과거 메시지 폭주 방지 — 의도된 설계).
- 이후 폴링에서 `newRooms` 각각: 뮤트&&!멘션이면 생략, 아니면
  - `playNotifySound()` (msgId 없음 — 250ms 디바운스만)
  - `notify(title, lastMessage, roomId)` — **가시성 무관** (포그라운드+다른 방에서도 OS 팝업)
  - `showRoomToast(roomId, ...)` — 인앱 토스트(탭→방 이동). **포그라운드+다른 방 커버 확인됨.**
- baseline(`_notifyLastAt`)은 알림 여부와 무관하게 항상 전진(재알림 방지).

### 판정 보조 함수
- `isMuted(roomId)`: localStorage `stella_talk_mute_v1`. **뮤트 = 소리/팝업/토스트 생략, 뱃지·목록 유지.**
- `mentionsMe(text)`: `@내id` 또는 `@내이름` 포함 시 true → **뮤트 무시하고 알림.**
- `bumpNotif(roomId)`: 방별 연속 수신 카운트 → notify에서 "메시지 N개" 합치기. `openRoom()`에서 `clearNotifCount()`.

## 2. 소리 단계 — `playNotifySound(msgId)` (talk.html ~1622)

1. `getNotifMode()` (localStorage `stella_talk_notify_<myId>`, 레거시 soundOff/stella_talk_sound 마이그레이션):
   - `silent` → 종료 / `vibrate` → `navigator.vibrate([120,60,120])` 후 종료 / `sound` → 계속.
2. 디바운스: 같은 msgId + 250ms 내 재호출 차단, msgId 없으면 250ms 시간 디바운스만.
3. `unlockAudio()` 호출(아래 3절) 후:
   - `voiceSpeak` 켜짐 + 포그라운드면 `speakVoice(key)` (TTS 병행).
   - `_emit()`: mp3(`TALK_VOICE_MP3[key]`, 현재 전부 null) → 실패/없으면 `playMelody(key)`.
   - `_audioCtx.state==='suspended'`면 `resume()` **완료 후** `_emit()` (즉시 재생 시 무음 레이스 수정본).
4. `playMelody(key)`: WebAudio 합성 멜로디(음성키별 2~3음, sine+triangle 2레이어, 마스터게인 0.9). **미리듣기(previewSound)와 동일한 생성기 공유.**
5. `previewSound(key)`(설정 화면, 사용자 탭): `saveNotif({voiceKey,mode:'sound'})` + `unlockAudio()` + `playMelody(key)` + `speakVoice(key)`. TTS는 **미리듣기 전용**(실수신은 멜로디 — STAGE 2 설계).
6. `ttsVoice()`: `getVoices()` 비동기 대응(`onvoiceschanged` 워밍업, 1487행), `synth.cancel()` 후 speak, 700ms 내 미시작 시 `beepFallback()`.

### 저장 키 정합성 (확인 결과: 일치)
- 쓰기: `saveNotif()` → `stella_talk_notify_<getMyId()>` / 읽기: `loadNotif()` 동일 키. 음성키 s1/s2/byeolping/gongju/byeolha/queen 전부 `TALK_VOICES`에 존재, 불명 키는 s1 폴백.

## 3. 오디오 언락 (자동재생 정책 대응)

- `unlockAudio()` (~1497): AudioContext 생성 + 무음 buffer 1회 재생 + suspended면 resume + speechSynthesis 무음 utterance 1회.
- 등록: `document` `touchstart`/`click` **영구 리스너**(1516-1517) + 1회용 `setupAudioUnlock()`(첫 제스처에서 unlock + `Notification.requestPermission()`).
- 복귀 시: `visibilitychange(visible)`/`focus` → `_wakeAudio()` (ctx.resume + speechSynthesis.resume).
- **한계(구조적)**: 페이지 로드 후 사용자 제스처가 한 번도 없으면 ctx는 suspended 고정 → 포그라운드 무음. 백그라운드/화면꺼짐은 WebAudio 자체가 OS에 의해 정지 → **SW 알림의 OS 기본음(`silent` 미지정 = 소리 있음)에 위임.**

## 4. 팝업 단계 — `notify(title, body, roomId)` (talk.html ~1374)

1. `Notification.permission !== 'granted'`면 **조용히 return** (권한 유도는 5절 배너가 담당).
2. `bumpNotif` → 같은 방 연속이면 body "메시지 N개".
3. tag `stella-talk-<roomId>` + `renotify:true` + `vibrate` + `data:{url:'/talk?room=<id>', roomId}`.
4. **[수정 전 결함]** `navigator.serviceWorker.controller` 존재 시에만 `ready.then(reg.showNotification)`,
   controller 없으면(=최초 로드/하드 리로드) `new Notification()` 직행 →
   **안드로이드 크롬은 페이지 Notification 생성자 미지원(Illegal constructor throw)** → 외곽 try-catch가 삼켜 **최초 1회 팝업 무손실 유실**. (testNotify는 ready 경로라 테스트만 성공하는 불일치.)
5. sw.js `notificationclick`: 열린 /talk 창 focus + `OPEN_ROOM` postMessage(딥링크) 또는 `openWindow('/talk?room=X')`.
6. `clearTalkNotifications()` (방 열기/포커스 복귀): `stella-talk` 접두 태그 전부 close + 뱃지 갱신.

## 5. 권한 흐름

- `initTalk()` → 2초 후 `requestNotification()`: default면 requestPermission (제스처 없이는 브라우저가 무시 가능).
  **[수정 전 결함]** granted 콜백에서 `new Notification(...)`을 try-catch 없이 직접 호출 → 안드로이드 크롬에서 throw → **`subscribePush()`·`updateNotifBanner()`가 스킵됨.**
- `updateNotifBanner()` (initTalk + visibilitychange visible): 로그인 + 미허용 + 미해제(sessionStorage)면 상단 배너. denied면 "브라우저 설정 안내"로 교체(버튼 숨김).
- `enableNotif()` (배너 버튼 = 사용자 제스처): requestPermission → granted면 배너 숨김 + toast + SW 등록 보장 + `subscribePush()`.
- `setupAudioUnlock()` 첫 제스처에서도 default면 requestPermission.

## 6. 뱃지·읽음 단계

- `updateAppBadge()`: 로컬 메시지 기반 미읽음 합산(열지 않은 방은 서버 `_srvUnread`), `navigator.setAppBadge` + 탭 타이틀.
- 읽음 보고: `openRoom()`/가시 상태 sync에서 `reportRead()`; `mergeReadsMonotonic()`이 reads를 **단조 증가로만** 병합(FIX-LOCK [1], "1" 되살아남 금지).
- 임시 메시지 dedupe: `m_` 임시 id ↔ 서버 `clientId` 에코 매칭 + (from,text,±10s) 폴백 — 알림 경로와 독립.

## 7. sw.js (stella-v115 → 2차 수정에서 v116)

- fetch 전략: `/api/` 무개입 / HTML·루트 네트워크 우선 / 정적자원 캐시 우선+백그라운드 갱신 — **전략 변경 금지, 버전 범프만 허용.**
- `push`: showNotification(tag `stella-talk-msg`) / `notificationclick`: 딥링크 / `periodicsync`: PERIODIC_SYNC 브로드캐스트 / `message`: skipWaiting·clearCache.

## 회귀 체크 대상 요약 (수정 시 전수 재확인)

1. 읽음 "1": visible일 때만 읽음 처리 (1293행) — 알림 수정과 무관하게 유지될 것
2. m_ 임시 ↔ 서버 확정 dedupe (1275-1285행)
3. mergeReadsMonotonic 단조 병합 (1209행)
4. per-room 뮤트(소리/푸시 생략·뱃지 유지)·멘션 예외 (1306-1313, 2995-3001행)
5. "새 메시지" 칩 강제 스크롤 금지 (1302-1304행)
6. 알림 합치기 "메시지 N개" (notify 내 bumpNotif)
7. 알림 클릭 → OPEN_ROOM 딥링크 (sw.js notificationclick + setupSWMessages)
8. updateAppBadge 갱신 지점 (수신/방열기/알림닫기)
9. sw.js 캐시 전략 불변 (버전만 v116)
