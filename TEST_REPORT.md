# TEST_REPORT — Stella Talk 메신저 품질 개선 (2026-07-08 ~ 07-10)

## 4차: 백그라운드 푸시 미수신 — 조용한 실패 제거 + 폰 자가진단 (2026-07-10)

### 증상 (실기기)
상대 폰이 소리 모드인데 앱 미접속(다른 앱/탭 닫힘/화면 꺼짐) 상태에서 메시지 수신 시
알림음도 팝업도 없음.

### 진단 요약 (요구된 4개 항목, 코드 레벨)
1. **SW 등록/push 리스너**: ✅ 존재(`sw.js` push/notificationclick). ❌ `pushsubscriptionchange`
   핸들러 없음 — 브라우저가 구독을 회전시키면 푸시가 영구 소멸(재구독 없음).
2. **Web Push 구현**: ✅ VAPID 자동키(Drive 영속)·구독 저장·send 훅 존재. ❌ 그러나 체인에
   **조용한 실패** 4곳: ①구독 읽기 오류가 빈 목록으로 영구 캐시 → 그 사용자행 푸시 전부 스킵
   ②구독 저장이 읽기 오류 시 타 기기 구독을 덮어씀 ③web-push 발송 오류(401/403 VAPID 불일치 등)
   무로그 무시 ④클라 subscribePush 실패 전부 삼킴 — 어디서 끊겼는지 확인 불가.
3. **알림음 방식**: 포그라운드 WebAudio/TTS(설계 의도대로), 백그라운드는 SW showNotification
   시스템음(`silent:false`) — 브라우저 제약상 커스텀 사운드 불가(설계 유지).
4. **manifest/권한 흐름**: ✅ standalone/scope OK, 권한 배너+요청 흐름 존재.

### 수정
| 파일 | 내용 |
|---|---|
| `lib/push-send.js` | 구독 캐시 TTL 10분+오류 미캐시(오염 방지), 저장 시 strict 읽기(타 기기 구독 clobber 방지), 발송 오류 status 로그+집계, `sendTestPush`(본인 E2E 테스트) |
| `api/push-subscribe.js` | `action=status`(서버 푸시 활성/키 출처/내 구독 수) + `action=test`(5초 지연 후 실제 푸시 발송 — 홈으로 나가서 수신 확인) |
| `talk.html` | 설정→알림에 **"🩺 상태 확인 / 📲 테스트" 패널**: 권한→SW→기기 구독→서버 푸시→서버 저장 구독 수를 단계별 ✅/❌ 표시, 빠진 단계 자동 재구독. subscribePush 실패를 단계별 기록(진단 표시) + 성공 시 SW에 PUSH_CFG 영속 |
| `sw.js` (v118) | **`pushsubscriptionchange` 재구독**: 저장된 VAPID 키·userId로 앱이 닫혀 있어도 SW가 재구독+서버 재등록 |
| `test/push-send-keys.test.js` | 캐시 오염 방지·clobber 방지 계약 2케이스 추가 |

### 검증
- `npm test` **420/420 통과**, `node --check`, sw 파싱, jsdom 스모크(상태 패널 단계별 렌더 확인 —
  "❌ 알림 권한 → ✅ 서비스워커 → ❌ 기기 구독 → ❌ 서버 푸시" 형식 출력 확인)
- 실기기 확인 절차: 두 폰 **설정 → 강제 업데이트**(v118) → **설정 → 알림 → 🩺 상태 확인**
  (5개 항목 전부 ✅ 인지 확인, ❌ 있으면 표시된 단계가 원인) → **📲 테스트** 누르고 5초 안에
  홈 화면으로 → 팝업 오면 백그라운드 체인 전체 정상.
- Postgres 대신 Drive(`PushSubs/`)에 구독 저장 — 이 레포의 저장소 규약(Drive primary)을 따름.

---

## 3차: 실사용 테스트 피드백 반영 — 키보드 닫힘 / 알림음 오타이밍 / 무음 반전 (2026-07-10)

### 실기기 테스트 대화 내용 (첨부)
> 부부 실사용 테스트(카톡 캡처). 스텔라톡으로 서로 대화하며 확인:
> - "1. 사진 보낼 때 자판이 숨겨짐 저절로 … 글자써도"
> - "2. 팝업 뜰 때 (별하공주님/스텔라 등) 설정한 소리가 나와야 하는데, 문자 치거나 사진 보낼 때·타이핑할 때 울림"
> - "3. 핸드폰(환경설정) 무음일 때 팝업은 나와야 하는데 안 나오고, 소리는 무음이면 안 나와야 하는데 나옴"
> - "그래도 메시지 보내는 건 개선된 듯 / 그건 그래ㅋㅋ" (전송 자체는 정상 확인됨)

### 원인
1. **키보드 닫힘**: 포그라운드 알림음 재생 시 `speakVoice()`→`speechSynthesis.speak()` 호출.
   **안드로이드 크롬은 TTS 시작 시 소프트키보드를 강제로 닫는다.** 입력 중 메시지가 도착하면
   TTS가 발동해 자판이 사라졌고, 사용자는 "타이핑/사진 보낼 때 자판이 닫힌다"로 체감.
2. **알림음 오타이밍**: 위와 동일 사건(입력 중 수신 시 TTS/소리)을 "내가 타이핑할 때 울린다"로 체감.
   (백엔드 typing 액션은 이벤트를 emit하지 않아 타이핑 자체로는 소리가 안 남을 코드로 확인 — 근본은 TTS 타이밍.)
3. **무음 반전**: 앱의 `silent` 모드는 인앱 소리(`playNotifySound`)만 막았고, **백그라운드 SW 푸시가
   폰 기본 알림음을 그대로 울렸다**(앱 무음설정이 SW로 전달 안 됨). 그래서 "무음인데 소리 남". 또한
   포그라운드 타방 알림의 `notify()` 시스템 팝업도 무음설정을 무시하고 기본음을 냈다.

### 수정
| 파일 | 내용 |
|---|---|
| `talk.html` | ①**입력창 포커스 중이면 TTS 생략**(멜로디=WebAudio는 IME 안 뺏음 → 키보드 유지). 파일 선택/전송 후 입력창 재포커스 ②`handlePushMessage` 자기 senderId 무시(자기수신 방어) ③`swSyncState`/`setNotifyMode`가 알림모드를 SW에 전달 ④`notify()` 시스템 팝업: 무음모드/포그라운드면 `silent:true`(이중음·무음위반 방지) |
| `sw.js` (v117) | 푸시 팝업에 알림모드 반영 — **무음이면 `silent:true`(팝업 배너는 유지, 소리·진동만 억제)**. 알림모드/뮤트를 **Cache에 영속화**해 앱 완전종료 후 콜드 스타트 푸시도 무음/뮤트 존중. prefs 캐시는 SW 업데이트 시 보존 |
| `lib/push-util.js` · `lib/push-send.js` | 푸시 payload에 `senderId` 포함(수신 창 자기수신 방어) |
| `test/push-util.test.js` | senderId payload 테스트 추가 |

### 검증
- `npm test` **418/418 통과**, `node --check`, sw.js 파싱, jsdom 스모크(swSyncState가 NOTIFY_MODE/MUTES 전송, 신규 함수 로드) 통과
- 실기기 확인 순서(중요):
  1. 두 폰 스텔라톡 재실행(설정→강제 업데이트로 v117 확실히 로드)
  2. **알림 권한 허용**(상단 배너) — 백그라운드 팝업의 전제
  3. 입력 중 상대 메시지 도착 → 자판 유지되는지(닫히면 회귀)
  4. 설정 소리 모드: 수신 시 멜로디+음성("별하공주님"). 무음 모드: 팝업은 뜨되 무음
- 정직한 웹 한계: 앱이 **완전 종료된 백그라운드 팝업의 알림음은 폰 시스템 기본음**(웹은 커스텀 사운드 파일
  미지원). 설정한 "별하공주님/스텔라" 음성은 앱이 화면에 떠 있을 때 재생. 무음 설정은 백그라운드에서도 존중(무음).

---

## 2차: 실사용 테스트 피드백 반영 — "팝업 안 뜸 + 수신음이 설정 음성이 아님" (2026-07-10)

사용자 실기기 테스트 결과(카톡 스샷): ① 수신자 기기에 카톡식 팝업이 전혀 안 뜸
② 수신음이 설정된 음성("스텔라~")이 아니라 "띠리링" 한 번.

### 원인
1. **팝업**: 백그라운드/앱종료 팝업은 Web Push(VAPID)가 필수인데, `.env`에 VAPID 키가 없어
   푸시 경로 전체가 휴면(no-op) 상태였음. 앱이 열려 있을 때만 폴링 기반 알림이 동작.
2. **수신음**: 설정 화면 미리듣기는 멜로디+음성(TTS "스텔라~")을 재생하지만, 실제 알림 경로
   (`playNotifySound`)는 멜로디만 재생 — 미리듣기와 실동작 불일치.

### 수정
| 파일 | 내용 |
|---|---|
| `lib/push-send.js` | ★**VAPID 키 자동 부트스트랩**: env 키 없으면 서버가 최초 1회 생성해 Drive `PushSubs/__vapid__`에 영속 후 재사용 → 수동 설정 없이 배포 즉시 푸시 활성. 읽기 오류 시엔 절대 재생성 안 함(키 회전=전체 구독 무효 방지). 푸시 본문 "보낸이: 내용" |
| `api/push-subscribe.js` | 키 자동해석 기반으로 enabled/publicKey 응답 |
| `sw.js` (v116) | 푸시 팝업 방별 태그(스택), **보고 있는 방이면 팝업 생략**(카톡 동일), 방별 뮤트 존중, 열린 창에 PUSH_MESSAGE 즉시 전달 |
| `talk.html` | ①실제 알림에서도 설정 음성 재생(멜로디+음성, TTS 불가 시 이중 비프 방지 quiet 모드) ②SW에 현재 방/뮤트 상태 동기화 ③PUSH_MESSAGE 수신 → 즉시 동기화+인앱 음성/토스트(폴링 중복 알림 방지 baseline 전진) ④구독 재시도(복귀 시, 성공 후 10분 가드) |
| `test/push-send-keys.test.js` (신규) | 키 생성·영속/재사용/오류 시 회전 금지/env 우선/구독 upsert — 5케이스 |

### 검증
- `npm test` **351/351 통과**, `node --check`, sw.js `new Function` 파싱, jsdom 스모크(신규 함수 포함) 통과
- 실기기 확인 필요: 수신자 폰에서 알림 권한 허용(앱 상단 배너 "알림 켜기") 후 →
  앱을 닫아도 카톡처럼 시스템 팝업 수신. 앱 열고 있으면 설정한 음성("스텔라~")으로 울림.
- 참고: 브라우저 보안 정책상 **백그라운드 팝업의 알림음은 시스템 기본음**(웹은 커스텀 사운드 불가 —
  네이티브 앱과의 차이). 설정 음성은 앱이 화면에 떠 있을 때 재생됨.


---

# TEST_REPORT — Stella GPT "새 노트" 클릭 무반응 버그 수정 (2026-07-10)

## 진단

`index.html`의 `renderAll()`이 옛 "게시판(post)" 기능의 `renderPostSelect()` / `renderPosts()`를
여전히 호출하고 있었다. 두 함수는 `#postCategorySelect`, `#postList` DOM 요소를 참조하는데,
이 요소들은 이미 이전 리팩터링(게시판 → 노트 패널 전환)에서 마크업에서 제거된 상태였다.
`renderPosts()`에는 null 가드가 없어 `$('#postList').innerHTML=...`에서 매번
`TypeError: Cannot set properties of null`을 던졌다.

`renderAll()`은 로그인 시 `showApp()` 안에서 호출되는데, 그 예외가 잡히지 않고 그대로
전파되면서 **`renderAll()` 직후에 실행돼야 할 `restoreAllData()`(Drive에서 노트/채팅/프로젝트
복원)가 로그인마다 조용히 스킵**되고 있었다. 실제 서버 정적 파일을 대상으로 jsdom
풀부트 재현 스크립트를 돌려 확인함:

```
initAuth() ERROR -> TypeError: Cannot set properties of null (setting 'innerHTML')
    at renderPosts (...) at renderAll (...) at showApp (...) at initAuth (...)
```

"새 노트" 버튼(`openNoteNew()`) 자체는 이 예외와 별개로 인라인 `onclick`이라 클릭 시 열리긴
하지만, 로그인 시점에 Drive 복원이 죽어있어 노트 목록이 비거나 오래된 로컬 캐시만 보이고,
매 렌더마다 `renderChips()/renderManage()`와 사용자명 갱신까지 함께 스킵되는 광범위한
회귀였다.

## 원인 (근거: git log)
- 노트 UI 자체의 최근 커밋(`98b7bb4` 노트 고정 폴더 통일)은 `api/note.js`/`lib/drive-utils.js`
  백엔드만 건드렸고 index.html은 빌드 버전 문자열 1줄만 바뀜 — 이번 버그와 무관.
- `renderPosts()`/`renderPostSelect()`는 과거 "게시글(post)" 카테고리 게시판 UI의 잔재로,
  해당 HTML(`#postList`, `#postCategorySelect`)이 삭제된 뒤에도 `renderAll()` 호출부만 남아있던
  죽은 코드였다.

## 수정
- `index.html`: `renderAll()`에서 `renderPostSelect();renderPosts();` 호출 제거.
- `index.html`: 호출부가 없어진 `renderPostSelect()`/`renderPosts()` 함수 정의 자체도 제거(죽은 코드 정리).

## 검증
- `node -e "new Function(...)"` — 인라인 스크립트 4블록 모두 구문 오류 없음.
- jsdom 풀부트 재현: 실제 정적 파일 서버로 index.html 로드 → 세션 시딩 →
  `initAuth()` 호출 → 수정 전 TypeError 발생 확인 → 수정 후 예외 없이 완주 +
  `[Restore] 전체 복원 완료` 로그로 `restoreAllData()` 정상 실행 재확인.
- `openBoardBtn` 클릭 → 노트 패널 열림, `+ 새 노트` 버튼 클릭 → 편집기 표시 전환
  (`noteEditorView` display:flex, 제목에 오늘 날짜 자동 입력) 확인.
- 신규 회귀 테스트 `test/note-new-button.test.js` 2건 추가:
  1) index.html에 `#postList` 등 죽은 참조가 재발하지 않는지 정적 검사
  2) jsdom으로 로그인 → `renderAll()` 무예외 완주 → "새 노트" 클릭 → 편집기 오픈까지 통합 검증
- `npm test` **348/348 통과** (기존 346 + 신규 2).

## 한계 (정직)
- 실제 Drive 자격증명/실브라우저 환경에서의 최종 시각적 확인은 배포 후 확인 필요.
  샌드박스에서는 jsdom + 정적 파일 서버로 재현·검증.
