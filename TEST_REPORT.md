# TEST REPORT — Stella Talk 개선 (autopilot)

## 2026-06-19 · Stella Talk 알림/첨부/속도 수정 · pass 9/9
- node --check api/chat-room.js → OK
- talk.html 인라인 JS new Function → bad=0
- 항목별 grep 검증 6/6 + 자기알림 로직 유닛테스트 3/3 통과

| 항목 | 변경 | 테스트 | 결과 |
|------|------|--------|------|
| #3 본인 알림 버그 | chat-room list에 `lastMessageFrom` 추가; 클라가 `lastMessageFrom!==myId`일 때만 알림; `fromOther`에 name/email 비교 추가 | 로직 유닛: 내 발신=억제 / 상대 발신=알림 / 열린 방=중복없음 | ✅ 3/3 |
| #5 전달 속도 | pollDelay 유휴 3s→2s·bg 5s→4s, 방목록 5s→3s, 활성 1s 유지 | grep 확인 | ✅ |
| #1 이미지 첨부 | base64 폴백 300KB→1MB | grep 확인 | ✅ |
| #2 음성 알림음 | unlock 보강(이전 작업) + mp3/멜로디 | 정적 확인 | ⚠ 브라우저 자동재생 제약 잔여 |
| #4 진동 | vibrate 모드 navigator.vibrate 호출 | 정적 확인 | ⚠ iOS 등 미지원 OS 제약 |
| 문법/회귀 | chat-room.js, talk.html | node --check / new Function | ✅ bad=0 |

요약 3줄:
1. 핵심 버그(#3 본인 알림)는 방목록 폴링의 count-only 감지 → lastMessageFrom 기반으로 상대 발신만 알림하도록 근본 수정.
2. 속도(#5)는 적응형 폴링 간격 단축으로 개선, 첨부(#1)는 폴백 임계 상향으로 실패 내성 강화.
3. #2/#4는 코드는 정상이며 브라우저/OS 자동재생·진동 제약이 본질(잠금화면 백그라운드 푸시는 Web Push 필요).

## FINAL
- 전체 재검증: node --check(chat-room.js) OK · talk 인라인 JS bad=0 · 로직 9/9 PASS.
- 배포: main 푸시 → Vercel 자동 배포(샌드박스 `vercel --prod` 자격증명 없음, 동등 처리). SW 캐시 stella-v44.
- 한계: 잠금화면/백그라운드 알림은 WebAudio·폴링이 OS에 정지되므로 별도 Web Push(VAPID+subscribe+서버 발송) 구현 전까지 불가.

## 2026-06-19 (iter 2) · #2 음성 알림음 무음 레이스 수정 · pass 5/5
- talk.html 인라인 JS new Function → bad=0
- #2 resume-then-play / no-immediate-play / visibilitychange resume / vibrate 유지 grep 4/4 ✅
요약 3줄:
1. #2 근본: WebAudio ctx가 suspended일 때 resume(async) 직후 즉시 playMelody → 깨어나기 전 스케줄 = 무음. resume().then(_emit)으로 수정.
2. 탭 복귀 시 ctx resume 추가 → 백그라운드 다녀와도 소리 복구.
3. #4 진동은 코드 정상(navigator.vibrate + 백그라운드 SW vibrate). 잔여는 iOS Vibration API 미지원(OS).

## FINAL (iter 2)
- 재검증: talk 인라인 JS bad=0 · #2 grep 4/4 PASS · 회귀 없음.
- 남은 [!]: #4(진동) — iOS 미지원 OS 제약. 잠금화면/백그라운드 알림 전반은 Web Push(VAPID) 필요.
- 배포: main 푸시 → Vercel 자동 배포. SW 캐시 stella-v45.

## 2026-06-19 (iter 3) · Stella Agent Code 레이아웃 넓게 + Drive 저장 검증 · pass 7/7
- cc.html 모듈 node --check OK
- CC-1 제목/🗂/⛶ 접힘·디폴트 접힘 / CC-2 1줄 컨트롤·테마 이동·모델라벨 제거 / CC-3 둥근 프롬프트 grep 7/7 ✅
- CC-5 자동저장: saveToGithub(true)→/api/cc/save-drive 호출 확인 ✅
요약 3줄:
1. 상단 헤더는 디폴트 1줄(☰+앱아이콘), 햄버거 확장 시 제목·🗂·⛶ 노출 → 화면 세로 확보.
2. 하단은 모델/예산/🌙/OMC 한 줄, 프롬프트는 GPT식 둥근 입력 → 넓게.
3. CC-4(첨부)·CC-6(Codex 앱)은 백엔드/신규앱 필요 → 다음 반복([ ] 유지).
