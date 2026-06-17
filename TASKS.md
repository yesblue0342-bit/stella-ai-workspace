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
- [~] A1 remember me — 세션이 localStorage에 저장되어 재접속 유지(사실상 항상 remember).
  명시적 "자동 로그인 체크박스" UI는 미구현 → [부분/UI추가 대기]
- 마이너 노트: index.html forgotPassword의 로컬 레거시 경로에 `btoa` 해시 사용(서버 SSOT 아님).
  보안 위험 낮으나 추후 제거 권장(서버 PBKDF2가 실제 인증).

## PART B. 친구
- [ ] B1 친구 목록 화면
- [ ] B2 아이디로 친구 추가/검색(추가해야 노출)
- [ ] B3 프로필 사진/이름 편집
- 메모: api/user-search.js 존재(아이디 검색 토대).

## PART C. 버그
- [ ] C1 동영상 재생/다운로드 (대용량 ~21MB) — 근본원인: drive-upload bodyParser 10mb 한도 →
  base64 21MB(≈28MB) 초과로 실패. 해결: drive-upload-url.js(서명 URL/resumable) 경로로 전환 필요.
- [~] C2 진동/무음 — `setNotifyMode('vibrate')`+`navigator.vibrate([120,60,120])`(talk.html:1192) 존재.
  [코드존재/실기기검증대기] (Android Chrome는 사용자 제스처 필요)
- [x] C3 방 나가기 영구 반영 + 부활 방지 — **완료**:
  - 서버 `api/chat-room?action=leave`(멤버 제외+left 기록, 마지막이면 tombstone), `list`가 `shouldListRoom`으로
    나간 사람/삭제 방 제외. (lib/room-membership.js, 단위테스트 6/6)
  - 클라 deleteRoom: 로컬 left-set tombstone(`stella_talk_left_v1`) 기록 + 서버 leave 호출,
    syncRoomListFromServer가 left-set 방을 재추가하지 않음(부활 방지). (jsdom 4/4)
- [ ] C4 읽으면 알림 사라짐(Notification.close + 배지 갱신)
- [x] C5 배경 투명도/흐림 — **완료**: `.chat-bg-layer`의 불투명 `background-color:var(--bg)`가
  효과를 가리던 게 원인 → `transparent`로 변경. setBgOpacity/setBgBlur 인라인 적용·저장 검증(jsdom 5/5).
- [x] C6 배경 되돌리기 — `clearBgImage()`가 초기화 버튼(talk.html)에 이미 연결됨(이미지 제거+설정 초기화). 확인 완료.
- [x] C7 메시지 깜빡임 — 키 기반 증분 렌더 + clientId dedup + 서버 클로버링 수정(PR #3·#5)으로 해결.
  jsdom 테스트로 검증됨(test 이력). [검증완료]

## PART D. 알림음/PWA
- [ ] D1 알림음 옵션 추가(가족 음성) + mp3 배치 경로 안내
- [ ] D2 웹→PWA 설치 유도(manifest/SW 점검)

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
