# Stella Talk 백로그 (Ralph 루프 추적)

> 한 항목씩 구현→테스트→커밋. 실제 검증 증거 없이는 체크하지 않는다.
> 자동 검증 불가(실기기/실 Drive 필요) 항목은 [코드완료/실검증대기]로 구분.

## PART A. 계정/인증
- [ ] A1 초기화면 가입/로그인 + remember me
- [ ] A2 Stella GPT 계정 통합(동일 id/pw 양쪽 로그인)
- [ ] A3 Stella Talk 독립 가입 = 통합계정 생성
- [ ] A4 로그아웃 시 세션/캐시 초기화
- 메모: talk.html에 `doTalkLogin`(→/api/auth) + `showTalkLogin` 존재. /api/login·signup·auth 존재.
  비밀번호 해시 저장 여부를 api/signup·login에서 점검 필요(보안 인수조건).

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
- [ ] C3 방 나가기 영구 반영 + 방 중복 방지 — deleteRoom이 로컬 삭제만 → 서버 방목록 재동기화로 부활 가능.
  해결: sync-engine tombstone을 방 목록에도 적용(서버 영구 반영). (sync-engine.js 재사용)
- [ ] C4 읽으면 알림 사라짐(Notification.close + 배지 갱신)
- [ ] C5 배경 투명도/흐림 미적용 — setBgOpacity/setBgBlur가 layer.style에 직접 적용(talk.html:507/514).
  실제 레이어 변수(--_opacity/--_blur) 연결 점검 필요.
- [ ] C6 배경 사진 되돌리기(초기화) 버튼
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
