# Stella Talk — 알림음 가청성 + 자동 알림 권한 (진행/검증)

대상: `talk.html`(주) + `sw.js`(캐시 버전). main 직접 푸시.

## 변경 함수/요소
### 작업1 — 실제 알림음 가청성
- **`playMelody(key)`**: 마스터 GainNode(0.9, 클리핑 방지) 추가. 음 길이 0.18→**0.30s↑**, peak gain 0.30→**0.55**(attack 0.02s + 부드러운 exponential decay). 음 **2→3개**(상승 후 강조 지속음 = "딩-동~" 종소리감, 3개 미만이면 강조음 자동 추가). 각 음 **sine + triangle 2레이어**(배음 보강).
- **`playNotifySound(msgId)`**: 재생 직전 **`unlockAudio()` 1회 + `_audioCtx.resume()`**. mode==='sound'이면 mp3 우선 → 없으면 강화 `playMelody`. `voiceSpeak` 켜짐 + `visibilityState==='visible'`이면 `speakVoice(key)`도 호출(포그라운드 한정).
- **`loadNotif`/`saveNotif`**: `voiceSpeak`(기본 false) 추가. `toggleVoiceSpeak()` 신설. 설정 모달에 **"🔊 음성으로 읽기" 토글** + `syncSoundUI`에 상태 반영.

### 작업2 — 자동 알림 권한
- **배너 `#notifBanner`**(appWrap 상단, dismiss 가능): 로그인 상태 + `permission!=='granted'`이면 표시.
- **`enableNotif()`**: [알림 켜기](제스처) → `requestPermission()`; granted → 배너 숨김 + `toast('알림이 켜졌어요')` + `serviceWorker` 등록 보장(없으면 register, 있으면 유지). denied → 배너를 "브라우저 설정 > 사이트 권한 > 알림 허용" 안내로 교체.
- **`updateNotifBanner()`**: `initTalk()`(로그인 직후) + **`visibilitychange`(visible)** 마다 권한 재확인 → 표시/숨김 갱신. `requestNotification()`도 끝에 배너 갱신.
- 적시 자동 요청: 기존 `setupAudioUnlock`(첫 제스처) + `initTalk`의 `requestNotification`(2초) 유지. ※ 브라우저는 사용자 동작 없이 auto-grant 불가 → "자동" = 적시 자동 요청 + 미허용 시 원탭 배너.

### 작업3 — 혼자 테스트
- 설정 모달 **"🔔 알림 테스트" 버튼** → **`testNotify()`**: `unlockAudio()` → `playNotifySound('test-'+Date.now())`(소리), 권한 granted면 hidden 무관하게 `reg.showNotification('Stella Talk · 테스트', {body:'알림 테스트 ✅', tag:'stella-talk-test', renotify:true})`도 1회 → 혼자서 소리+팝업 동시 확인.

## 검증 결과
| # | 항목 | 결과 |
|---|------|------|
| 1 | talk.html 인라인 `<script>` `new Function` SyntaxError | **0** ✅ |
| 2 | 작업1 playMelody(마스터게인/peak0.55/triangle/3음) grep | ✅ |
| 3 | 작업1 playNotifySound(unlock+voiceSpeak 포그라운드) | ✅ |
| 4 | 작업1 voiceSpeak 토글(기본 off)+syncSoundUI 반영 | ✅ |
| 5 | 작업2 배너/enableNotif(granted 숨김+toast+SW)/denied 안내/visibilitychange | ✅ |
| 6 | 작업3 testNotify(소리+granted 팝업) 버튼 연결 | ✅ |
| 7 | `node --check sw.js` | OK ✅ |
| 8 | SW 캐시 bump | stella-v39 → **v40** ✅ |

## 커밋
- `feat(talk)`: 알림음 강화 + voiceSpeak + 테스트 버튼 (작업1+3)
- `feat(talk)`: 자동 알림 권한 배너 (작업2)
- `chore(talk)`: sw v40 bump + 진행 파일
> 단일 파일(talk.html) 특성상 작업3(테스트)는 사운드/모달과 묶어 작업1 커밋에 포함.

## 잔여 이슈
- **잠금화면/백그라운드 알림은 WebAudio·폴링이 OS에 정지되므로 별도 Web Push(VAPID + subscribe + 서버 발송) 구현 전까지 불가.** (현재는 포그라운드/탭 활성 시 소리·팝업, granted PWA에서 SW showNotification까지 — 진짜 백그라운드 푸시는 Web Push 필요.)
- 배포 보호(403)로 라이브 검증 불가 → 정적(new Function)·grep 검증까지 수행. 실제 소리 크기·팝업은 배포 후 기기에서 "🔔 알림 테스트"로 확인 권장.
