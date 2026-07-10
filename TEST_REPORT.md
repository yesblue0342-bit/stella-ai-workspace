# TEST_REPORT — Stella Talk 메신저 품질 개선 (2026-07-08 ~ 07-10)

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
