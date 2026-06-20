# Stella Talk 개선 — TODO

- [x] 1. 이미지 파일 첨부 — base64 폴백 임계 300KB→1MB(Drive 업로드 실패 시에도 스크린샷 등 첨부 가능). 첨부 UI/업로드 엔드포인트는 정상 확인.
- [x] 2. 음성 모드 알림음 — **무음 레이스 수정**: `_audioCtx`가 suspended일 때 `resume()`(async) 직후 즉시 재생하던 것을 `resume().then(_emit)`으로 변경(재생이 깨어난 컨텍스트에서 실행). 탭 복귀(visibilitychange)에도 컨텍스트 resume. 잔여: 첫 상호작용 전 자동재생/잠금화면은 OS 제약.
- [x] 3. 메시지 팝업이 본인에게 가던 버그 — 방목록 폴링이 "메시지 수 증가"만 보고 알림 → 내가 보낸 것도 본인 알림. `lastMessageFrom` 추가 + `!==myId` 가드로 상대 발신만 알림. `fromOther`도 name/email까지 비교 강화.
- [!] 4. 진동 모드 — playNotifySound가 vibrate 모드에서 `navigator.vibrate` 호출(코드 정상). 단 iOS Safari 등은 Vibration API 미지원 → OS 제약.
- [x] 5. 전달 속도 — 유휴 폴링 3s→2s, 백그라운드 5s→4s, 방목록 폴링 5s→3s. 활성 대화는 1s 유지. 텍스트는 clientId 에코로 즉시 확정.
- [x] 6. 개선 — 위 반영.

## 가정 로그
- `vercel --prod` CLI 자격증명이 샌드박스에 없어 배포는 **main 푸시 → Vercel 자동 배포**로 수행(동등).
- #2/#4는 브라우저/OS 제약(자동재생 정책·iOS 진동 미지원)이 본질이라 코드 보강 후 `[!]` 보류로 표기.
