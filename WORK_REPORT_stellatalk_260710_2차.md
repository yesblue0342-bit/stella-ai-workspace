# WORK_REPORT — Stella Talk 알림음·팝업 무인 개선 (2026-07-10, 2차)

대상: `talk.html`, `sw.js` (CACHE stella-v115 → **stella-v116**)
원칙: 원인으로 **확인된 지점만 최소 diff** 수정. 리팩터링 없음. 회귀 기준선은 `NOTIFY_FLOW.md`(수정 전 흐름 문서) 참조.

---

## 1. 증상별 근본 원인과 수정

### 증상 2 — 메시지 팝업이 최초에 안 뜸 【원인 확정】

**근본 원인 (소스 추적으로 확정):** `notify()`(talk.html ~1374행)가
`navigator.serviceWorker.controller` 존재를 조건으로 SW `showNotification()` 경로를 탔다.
controller는 **최초 방문·하드 리로드에서 null**(페이지가 SW 제어 밖에서 로드됨)이므로
첫 수신은 페이지 `new Notification()` 생성자로 빠졌고, **안드로이드 크롬은 페이지 생성자를
지원하지 않아(Illegal constructor throw)** 외곽 `try{}catch(e){}`가 예외를 삼켜 **팝업이 조용히 유실**됐다.
두 번째 로드부터는 controller가 있어 정상 → "처음엔 안 뜨고 이후에 뜨는" 증상과 정확히 일치.
또한 **테스트 버튼(testNotify)은 처음부터 `ready` 경로를 써서** 테스트만 성공하고 실전은 실패하는 불일치가 있었다.

**수정 (`notify()`):**
- controller 체크 제거 → `navigator.serviceWorker.ready` 대기 후 `reg.showNotification()`.
  SW 등록 완료 전에 도착한 첫 메시지도 등록 완료를 기다렸다가 표시된다.
- SW 실패(`catch`) 또는 **3초 내 미준비(타임아웃)** 시에만 페이지 `new Notification()` 폴백
  (데스크톱용 — 안드로이드에서 폴백이 실패하면 `console.warn` 기록, 빈 catch 아님).
- `_fellBack` 플래그 + `clearTimeout`으로 SW/폴백 **중복 표시 방지** (mock 테스트로 5개 상태 전수 검증, 아래 3절).

**부수 확정 원인 (같은 뿌리):** `requestNotification()`(권한 자동요청, ~2746행)이 granted 직후
페이지 `new Notification()`을 **try-catch 없이** 호출 → 안드로이드 크롬에서 throw →
**`subscribePush()`(Web Push 구독)와 `updateNotifBanner()`가 스킵**되던 버그.
→ 확인 알림을 안전한 `notify()` 경로로 교체 + try-catch(console.warn). 구독은 항상 진행된다.

**통일 (`testNotify()`):** 자체 팝업 코드 삭제 → 실수신과 동일한 `notify('테스트',...)` 호출.
권한 미허용이면 토스트("🔕 알림 권한이 꺼져 있어…") + console.warn으로 피드백 (기존: 무반응).

### 증상 1 — 알림음이 수신 시 안 울림 【복합: 확정 1 + 구조적 한계 1】

**확정 원인 (백그라운드/앱 종료 후 재실행 케이스):** 증상 2와 **같은 뿌리**.
화면 꺼짐·백그라운드에서 WebAudio/TTS는 OS가 정지시키므로, 이 상황의 "알림음"은
OS 알림 팝업의 기본음(`silent` 미지정 = 소리 있음)이 담당한다. 그런데 위 controller 버그로
**팝업 자체가 유실 → OS 알림음도 함께 유실**됐다. 팝업 수정으로 이 케이스의 소리도 함께 복구된다.

**구조적 한계 (포그라운드 무제스처 케이스):** 페이지 로드 후 사용자 제스처(터치/클릭)가
한 번도 없으면 자동재생 정책상 AudioContext가 suspended로 고정 → 멜로디가 무음.
- 오디오 언락(priming)은 **이미 구현돼 있음을 확인**: `unlockAudio()`가 `touchstart`/`click`
  영구 리스너 + 첫 제스처 1회용 리스너로 등록, `visibilitychange`/`focus` 복귀 시 `_wakeAudio()` resume.
  수신 직전에도 `unlockAudio()` + suspended면 `resume()` 완료 후 재생(레이스 수정본)이 이미 있다. → **동작 변경 없이 유지.**
- 추가한 것: 재생 후 400ms 시점에 ctx가 `running`이 아니면 `console.warn`
  (**진단 로그만, 동작 변경 없음** — 현장에서 "무음의 원인이 제스처 부재"임을 즉시 판별 가능).

**점검 결과 (수정 불필요로 확인된 항목):**
- 미리듣기 vs 수신 재생: 둘 다 동일한 `playMelody(key)` 생성기 공유 (TTS는 STAGE 2 설계상 미리듣기 전용) → 통일돼 있음.
- localStorage 키 정합성: 쓰기/읽기 모두 `stella_talk_notify_<myId>` 동일, 음성키 6종 전부 `TALK_VOICES` 존재, 불명 키 s1 폴백 → 불일치 없음.
- `getVoices()` 비동기: `onvoiceschanged` 워밍업(1487행) + `ttsVoice()` 700ms 비프 폴백 있음.
- 중복재생 방지: msgId 동일+250ms 내만 차단 — 정상 수신 차단 없음.
- per-room 뮤트/멘션: 뮤트 시 소리·팝업·토스트 생략 + 뱃지 유지, 멘션 시 뮤트 무시 — 소리 경로를 잘못 막는 지점 없음.

---

## 2. 변경 파일/지점 (전체 diff 4곳 + 문서 2개)

| 파일 | 지점 | 내용 |
|---|---|---|
| talk.html | `notify()` | controller 게이트 제거 → SW ready 대기 + 3초 타임아웃 페이지 폴백 + 중복 방지 + console.warn |
| talk.html | `testNotify()` | 실수신 경로(`notify()`)로 통일 + 미허용 시 토스트/warn |
| talk.html | `requestNotification()` | 확인 알림을 `notify()` 경로로 + try-catch → subscribePush 스킵 버그 제거 |
| talk.html | `playNotifySound()` | ctx not-running 진단 warn 1줄 (동작 변경 없음) |
| sw.js | `CACHE` | stella-v115 → **stella-v116** (전략 변경 없음, 버전만) |
| NOTIFY_FLOW.md | 신규 | 수신→판정→소리→팝업→뱃지→읽음 전체 흐름 (수정 전 기준선) |

아이콘 등 정적자원은 변경 없음 → `?v=3` 쿼리스트링 유지 (HTML은 SW가 네트워크 우선이라 즉시 반영).

## 3. 정적 검증 결과

| # | 항목 | 결과 |
|---|---|---|
| 1 | talk.html 인라인 `<script>` 4블록 `new Function` 파싱 | SyntaxError **0** ✅ |
| 2 | `node --check sw.js` | OK ✅ |
| 3 | `notify()` 호출부 전수(1310/1707/3016행) 시그니처 `(title, body, roomId)` 정합 | ✅ |
| 4 | 페이지 `new Notification` 잔존 검색 | notify() 내 의도된 폴백 1곳만(try-catch+warn) ✅ |
| 5 | notify() mock 상태 전수 테스트: SW정상 / SW정상+3초경과 / SW미준비 / SW미준비+3초 / SW미지원 | `[sw]` / `[sw]`(중복없음) / `[]`(대기) / `[page]` / `[page]` — **기대와 전부 일치** ✅ |
| 6 | `toast()` 존재 확인 (testNotify 미허용 분기) | 2230행 정의 ✅ |

## 4. 회귀 체크리스트 (지침 3절 전 항목 — diff 대조로 확인)

| 항목 | 결과 |
|---|---|
| 읽음 "1": `visibilityState==='visible'`일 때만 읽음 처리 (1265·1293행) | 미변경 ✅ |
| 임시(m_) ↔ 서버 확정 dedupe (clientId + 폴백 매칭) | 미변경 ✅ |
| `mergeReadsMonotonic` 단조 병합 (1262·1290행) | 미변경 ✅ |
| per-room 뮤트(소리/푸시 생략·뱃지 유지) + 멘션 예외 | 미변경 ✅ |
| "새 메시지" 칩 (강제 스크롤 금지) | 미변경 ✅ |
| 알림 합치기 "메시지 N개" (`bumpNotif`) | notify() 내 로직 그대로 유지 ✅ |
| 알림 클릭 → OPEN_ROOM 딥링크 (`data:{url,roomId}` + sw notificationclick) | opts 미변경, sw 미변경 ✅ |
| `updateAppBadge` 갱신 | 미변경 ✅ |
| sw.js HTML 네트워크 우선 / 정적 캐시 우선 전략 | CACHE 상수 1줄만 변경 ✅ |
| 기존 tag+`renotify:true` 유지 | 유지 ✅ (testNotify tag가 `stella-talk-test`→`stella-talk-msg`로 바뀌나 `stella-talk` 접두라 자동 닫힘 동작 동일) |

## 5. 수동 테스트 시나리오 (정적 분석으로 확인 불가 — 배포 후 기기에서)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| ① | 최초 방문(권한 미허용) 상태에서 첫 수신 | 팝업 없음(권한 없음), 상단 "🔔 알림 켜기" 배너 노출, 포그라운드+다른 방이면 인앱 토스트는 표시 |
| ② | 권한 허용 직후 첫 수신 (하드 리로드 직후 포함) | **팝업 표시** (이번 수정의 핵심 — 이전엔 안드로이드에서 유실). 콘솔에 `[notify]` 경고 없어야 함 |
| ③ | 포그라운드 + 같은 방 수신 | 팝업 없음(의도), 소리 울림, 읽음 즉시 처리 |
| ④ | 포그라운드 + 다른 방 수신 | 소리 + OS 팝업 + 인앱 토스트(탭→방 이동), 목록 미리보기/뱃지 갱신 |
| ⑤ | 백그라운드 탭 수신 | OS 팝업(기본음 포함, ≤4초 폴링 지연), 클릭 시 해당 방 딥링크 |
| ⑥ | 화면 꺼진 모바일 PWA | 탭이 살아 있으면 팝업+OS음. **앱이 OS에 의해 완전 종료되면 수신 불가** — Web Push(VAPID) 설정 필요(구조적 한계, `/api/push-subscribe?action=key`가 enabled:true여야 함) |
| ⑦ | 뮤트 방 수신 | 소리·팝업·토스트 없음, 방 목록 갱신·뱃지는 유지 |
| ⑧ | 뮤트 방 + `@내이름` 멘션 | 뮤트 무시하고 소리+팝업 |
| ⑨ | 음성 6종 미리듣기 (설정) | 각각 멜로디+TTS 재생, 선택 하이라이트, 수신음도 같은 멜로디로 변경됨 |
| ⑩ | 🔔 알림 테스트 버튼 | 소리 + "Stella Talk · 테스트" 팝업 (**실수신과 완전 동일 경로**). 권한 꺼짐이면 토스트 안내 |

추가 확인: ②~⑤에서 같은 방 연속 2건 수신 시 팝업 본문이 "메시지 2개"로 합쳐지는지, 방 열면 알림이 닫히는지.

## 6. 배포 반영 확인 방법

1. push → GitHub Actions `deploy-oci.yml`이 OCI 서버 재빌드/재실행 (Actions 탭에서 성공 확인).
   ※ 지침서에 Vercel로 표기돼 있으나 현행 배포는 **OCI**(CLAUDE.md 기준 — Vercel 자동배포 비활성).
2. https://gpt.xn--hu5b23z.com/talk 접속 → DevTools:
   - **Application → Cache Storage**에 `stella-v116` 생성(구버전 자동 삭제) 확인.
   - **Application → Service Workers**에서 활성 SW가 새 sw.js인지 확인 (HTML은 네트워크 우선이라 talk.html은 즉시 최신).
3. 콘솔 스탬프: 수신/테스트 시 `[notify]`·`[notifySound]` **경고가 없으면 정상 경로**,
   경고가 찍히면 그 reason(sw-not-ready / sw-failed / AudioContext state)이 곧 현장 원인이다.
4. 설정 → "🔔 알림 테스트"로 소리+팝업 동시 확인 (이제 실수신과 동일 경로이므로 테스트 통과 = 실전 통과).

## 7. 남은 과제

- **앱 완전 종료 상태 수신**: Web Push(VAPID 키 발급 + 서버 발송) 미설정이면 불가 — 클라이언트 구독 코드는 준비돼 있음(`subscribePush`, 이번에 스킵 버그도 제거). 서버에 VAPID 키만 설정하면 활성화된다.
- iOS PWA는 16.4+ 홈화면 설치 상태에서만 Web Push/알림 지원 — OS 제약.
- 포그라운드 무제스처 무음은 브라우저 정책상 완전 해소 불가(진단 로그로 관측 가능).
