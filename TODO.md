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

## Stella Agent Code 개선 + Codex 앱 (iter)
- [x] CC-1. 상단 헤더 1줄 접기(디폴트 접힘): 제목 텍스트·🗂·⛶는 햄버거 확장 시만, 접힘 시 ☰+앱아이콘만 → 화면 넓게.
- [x] CC-2. 하단 컨트롤 1줄: 모델/예산/테마(🌙)/OMC 한 줄(nowrap+가로스크롤), 테마 토글을 상단→하단 이동, "모델" 라벨 제거.
- [x] CC-3. 프롬프트 입력 라인 Stella GPT식(둥근 pill 컨테이너 + 라운드 버튼).
- [x] CC-5. 개발 완료 산출물 Google Drive(StellaGPT/0download) 자동 저장 — 완료 시 saveToGithub(true)→/api/cc/save-drive 자동 호출 확인됨.
- [ ] CC-4. cc 입력창 이미지/첨부 파일 업로드(상세 개발용) — 백엔드(Managed Agents turn) 첨부 수용 필요(다음 반복).
- [ ] CC-6. 빠른 즐겨찾기에 Codex 앱 추가(OpenAI 연결, cc.html 동일 레이아웃) — 신규 HTML+라우트(다음 반복).

## Stella Agent Code 미세 개선 (iter 4)
- [x] CC-7. 빈 화면 안내문구("모델을 고르고 코딩 작업을 요청하세요 예~") 숨김 → 깨끗한 빈 화면.
- [x] CC-8. 앱 아이콘 색 일관: 다크=흰 테두리+검정 바탕+흰 아이콘, 라이트=검정 테두리+흰 바탕+검정 아이콘(!important로 강제).
- [x] CC-9. "예산$" 라벨 줄바꿈(글자 내려감) 수정 → .lbl white-space:nowrap.
