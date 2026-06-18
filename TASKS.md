# Stella Talk 백로그 (Ralph 루프 추적)

> 한 항목씩 구현→테스트→커밋. 실제 검증 증거 없이는 체크하지 않는다.
> 자동 검증 불가(실기기/실 Drive 필요) 항목은 [코드완료/실검증대기]로 구분.

## PART A. 계정/인증
- [x] A 비밀번호 해시 점검 — **PASS**: 모든 경로(signup/login/auth/login/register/talk)가 api/auth.js로
  수렴, **PBKDF2(100k iters, SHA-512, 16B salt, `salt:hash`)** 저장. 평문 저장 없음.
  (login.js→auth/login.js→auth.js, signup.js→auth.js, register.js→signup.js→auth.js)
- [x] A2 계정 통합 — talk.html과 index.html 모두 동일 세션키 `stella_session_final_v82` 사용 +
  동일 /api/auth 백엔드 → 같은 id/pw로 양쪽 로그인. (코드 확인)
- [x] A3 독립 가입 — talk.html `doTalkLogin`/가입이 /api/auth(mode signup) 통합계정 생성.
- [x] A4 로그아웃 — talk/GPT 모두 세션키 제거 후 reload(캐시성 상태 초기화).
- [~] A1 remember me — **완료(체크박스 UI)**: 로그인 화면에 "자동 로그인 유지" 체크박스 추가.
  체크 시 localStorage(영구), 해제 시 sessionStorage(브라우저 종료 시 만료) + 선호 저장/복원.
  getSession이 sessionStorage 폴백. (jsdom 4/4)
- 마이너 노트: index.html forgotPassword의 로컬 레거시 경로에 `btoa` 해시 사용(서버 SSOT 아님).
  보안 위험 낮으나 추후 제거 권장(서버 PBKDF2가 실제 인증).

## PART B. 친구
- [x] B1 친구 목록 화면 — 설정의 '👥 친구 목록' 모달(친구만 노출, 삭제). (jsdom)
- [x] B2 아이디로 친구 추가/검색 — friendSearch(/api/user-search) → addFriendById(id 기준 dedup).
  추가한 사용자만 목록에 보임(미추가자 비노출). (lib/friends.js 단위 5/5 + jsdom)
- [x] B3 프로필 사진/이름 편집 — '🙂 내 프로필' 모달(사진 업로드 dataURL + 표시 이름=가입자명 기본). (jsdom)
- 구현: lib/friends.js(순수, globalThis.StellaFriends) + talk.html 모달/함수, 사용자별 localStorage 저장.
  [후속] 친구/프로필의 디바이스 간 Drive 동기화는 sync-engine 활용 가능(선택).

## PART C. 버그
- [~] C1 동영상 — **재생/다운로드 구현**: serverMsgToLocal이 mp4/webm/mov 등을 type 'video'로 감지,
  렌더가 <video controls> 인라인 재생 + 다운로드 링크(로드 실패 시 링크 폴백). 동영상 첨부를 Drive 업로드
  경로로 라우팅. (jsdom 6/6)
  [남음] 대용량(>~4.5MB Vercel payload 한도) 업로드는 서명URL/resumable(drive-upload-url.js) 전환 필요 — 후속.
- [~] C2 진동/무음 — `setNotifyMode('vibrate')`+`navigator.vibrate([120,60,120])`(talk.html:1192) 존재.
  [코드존재/실기기검증대기] (Android Chrome는 사용자 제스처 필요)
- [x] C3 방 나가기 영구 반영 + 부활 방지 — **완료**:
  - 서버 `api/chat-room?action=leave`(멤버 제외+left 기록, 마지막이면 tombstone), `list`가 `shouldListRoom`으로
    나간 사람/삭제 방 제외. (lib/room-membership.js, 단위테스트 6/6)
  - 클라 deleteRoom: 로컬 left-set tombstone(`stella_talk_left_v1`) 기록 + 서버 leave 호출,
    syncRoomListFromServer가 left-set 방을 재추가하지 않음(부활 방지). (jsdom 4/4)
- [x] C4 읽으면 알림 사라짐 — **완료**: `clearTalkNotifications()`가 SW의 `getNotifications({tag})`로
  떠있는 알림 close + 배지 갱신. openRoom(방 읽음) + visibilitychange/focus(앱 복귀) 시 호출. (jsdom 1/1)
- [~] C2 진동 — 코드 확인 완료: 수신 시 playNotifySound→mode 'vibrate'→navigator.vibrate([120,60,120]).
  [실기기 검증 대기] (Android Chrome 제스처 정책)
- [x] C5 배경 투명도/흐림 — **완료**: `.chat-bg-layer`의 불투명 `background-color:var(--bg)`가
  효과를 가리던 게 원인 → `transparent`로 변경. setBgOpacity/setBgBlur 인라인 적용·저장 검증(jsdom 5/5).
- [x] C6 배경 되돌리기 — `clearBgImage()`가 초기화 버튼(talk.html)에 이미 연결됨(이미지 제거+설정 초기화). 확인 완료.
- [x] C7 메시지 깜빡임 — 키 기반 증분 렌더 + clientId dedup + 서버 클로버링 수정(PR #3·#5)으로 해결.
  jsdom 테스트로 검증됨(test 이력). [검증완료]

## PART D. 알림음/PWA
- [x] D1 알림음 옵션 추가 — '👑 앵쥬 왕비님~'(queen) 보이스 추가(TALK_VOICES+UI), mp3 슬롯+sounds/README.md 안내. (jsdom 4/4)
- [x] D2 PWA 설치 유도 — beforeinstallprompt 캡처 → 설정의 '📲 앱 설치' 버튼 노출, prompt() 호출, appinstalled 처리. iOS는 수동 안내. (jsdom 2/2)

## PART E. 첨부 Drive 보관 (KST 날짜별)  ← 이번 반복
- [x] E: KST 날짜 유틸 `lib/kst-date.js` + 단위테스트(자정/연월 경계) — 7/7 PASS
- [x] E1/E2: api/drive-upload.js에 `archiveFamily` 옵션 — 업로드 후
  `0가족/1_사진/stella talk/[KST날짜]`로 사본 복사, 경로 자동 생성, 동일 이름 중복 방지.
  talk.html 이미지 업로드가 archiveFamily:true 전달. [코드완료/실Drive검증대기]
  - KST 자정 경계/경로 생성 로직은 유닛테스트로 검증. 실제 Drive 저장은 배포 후 실계정 확인 필요.

## DECISIONS
- 대규모 백로그는 Ralph 다회 반복으로 진행. 각 반복은 빌드·배포 가능 상태 유지, 메시징 핵심 회귀 금지.
- 이번 반복: 가장 자립적이고 테스트 가능한 PART E 우선(메시징 핵심 미접촉). C7은 기존 PR로 이미 해결됨 확인.
- 실기기/실Drive 필요한 항목은 코드 완료 후 [실검증대기]로 표기하고 배포하여 실환경 확인 유도.

## NEXT (다음 반복)
- C3: 방 나가기/중복을 sync-engine tombstone으로 서버 영구 반영.
- A: api/signup·login 해시 저장 점검 → talk.html 로그인/로그아웃/remember-me 정비.
- C5: 배경 opacity/blur 변수 연결 수정(소규모, jsdom 검증 가능).
