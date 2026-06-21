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
- CC-6 Stella Codex: 현재 백엔드 `/api/cc/*`(Anthropic Managed Agents) 재사용. OpenAI Codex 전용 코드실행 런타임이 인프라에 없어, 신규 API 키·라우트 없이 동일 런타임으로 우선 제공. OpenAI 백엔드 분리는 신규 인프라 필요 → 후속 반복.

## Stella Agent Code 개선 + Codex 앱 (iter)
- [x] CC-1. 상단 헤더 1줄 접기(디폴트 접힘): 제목 텍스트·🗂·⛶는 햄버거 확장 시만, 접힘 시 ☰+앱아이콘만 → 화면 넓게.
- [x] CC-2. 하단 컨트롤 1줄: 모델/예산/테마(🌙)/OMC 한 줄(nowrap+가로스크롤), 테마 토글을 상단→하단 이동, "모델" 라벨 제거.
- [x] CC-3. 프롬프트 입력 라인 Stella GPT식(둥근 pill 컨테이너 + 라운드 버튼).
- [x] CC-5. 개발 완료 산출물 Google Drive(StellaGPT/0download) 자동 저장 — 완료 시 saveToGithub(true)→/api/cc/save-drive 자동 호출 확인됨.
- [x] CC-4. cc/codex 입력창 이미지 첨부 — 프런트(📎 버튼+파일선택+붙여넣기, 개당 3.5MB 상한, base64), 백엔드(`_maclient.sendUserMessage`가 attachments→image 콘텐츠 블록, start.js/turn.js 통과). 텍스트는 항상 보장 경로(첨부 단독 전송도 허용). ※ Managed Agents 런타임 image 블록 수용은 Claude 기반이라 지원 예상이나 샌드박스 자격증명 부재로 라이브 미검증.
- [x] CC-6. 빠른 즐겨찾기에 Stella Codex 앱 추가 — `codex.html`(cc.html 동일 레이아웃, 명칭 "Stella Codex", 아이콘 ⌨ 흑백 통일), 바로가기에 Agent Code 바로 아래 배치(index.html/abap.html), `/codex`·`/stella-codex` 라우트(vercel.json), sw.js network-first+캐시 v48. ※ 백엔드는 현재 Agent Code(Managed Agents) 런타임 재사용 — OpenAI Codex 전용 코드실행 런타임이 인프라에 없어 추후 분리(아래 가정 로그).

## Stella Agent Code 미세 개선 (iter 4)
- [x] CC-7. 빈 화면 안내문구("모델을 고르고 코딩 작업을 요청하세요 예~") 숨김 → 깨끗한 빈 화면.
- [x] CC-8. 앱 아이콘 색 일관: 다크=흰 테두리+검정 바탕+흰 아이콘, 라이트=검정 테두리+흰 바탕+검정 아이콘(!important로 강제).
- [x] CC-9. "예산$" 라벨 줄바꿈(글자 내려감) 수정 → .lbl white-space:nowrap.

## Stella Agent Code / Codex 툴바·모델 (iter 7, autopilot)
- [x] T1. cc.html·codex.html 프롬프트 placeholder에서 "(Enter 전송 / Shift+Enter 줄바꿈)" 제거 → "코딩 작업을 입력하세요"만.
- [x] T2. 하단 툴바 컬러 이모지(🌙/☀️ 테마·🤖 OMC·파란 체크박스)를 사이드바와 동일한 흰색 모노크롬 라인 SVG(stroke=currentColor)+중립 체크박스(accent-color:var(--muted))로 교체. cc.html/codex.html 공통.
- [x] T3. Stella Codex만 모델 목록 OpenAI 계열만 노출(Claude 제거) + OpenAI API 고정(`/api/chat` bare 모드, 기본 gpt-4.1-mini). 샌드박스 전용 기능 제거→채팅형 코딩 어시스턴트, 대화 localStorage 보관. Stella Agent Code(cc.html)는 Claude/Managed Agents 그대로. (가정: PROGRESS.md)

## 성능·알림·전송 (iter 8, autopilot)
- [x] G1. (Stella GPT) 응답 속도: api/chat.js에 구간 타이밍(memory/context/model/total) 계측 추가 → 응답 `timings`+서버 로그. 병목인 메모리 로드(Azure SQL+Drive, 매 요청)를 (a)검색/Drive와 병렬화, (b)warm 인스턴스 60s 캐시로 반복 fetch 제거(업데이트 시 무효화). 구조적 개선: 반복요청 메모리준비 180ms→~0, 검색+Drive 케이스 준비 501→321ms. (스트리밍은 SSE 라이브검증 불가로 후속, PROGRESS.md)
- [x] T1. (Stella Talk) 알림이 대화창 안에서만 뜨던 문제 수정 → 전역 폴링(syncRoomListFromServer, 3s)을 **since(lastMessageAt) 기반**으로 재작성. 앱 열려있는 동안 대화목록·다른 화면 포함 모든 방의 상대 발신 새 메시지 감지 → Notification+소리. 최초 1회 baseline 프라이밍(앱 열 때 과거메시지 폭주 방지), 보고있는 방/내 발신 제외, 재알림 방지(per-room ts 저장). 백엔드 list에 lastMessageAt 추가. (로직 유닛테스트 7/7) · [!] 완전종료(앱 kill) 푸시는 Web Push(VAPID) 인프라 필요 = 후속, iOS는 OS 제약.
- [x] T2. (Stella Talk) 전송 속도: 낙관적 UI(즉시 표시·sendState sending/sent/failed·retryMsg·clientId dedup)는 기구현 확인. 백엔드 send 응답이 매 전송마다 **전체 방 히스토리(room:data)**를 싣던 것을 제거 → 확정 메시지 1건만 반환(50/200/500 메시지 방에서 97~100% 페이로드 감소 = 확정 round-trip 단축). (가정: Drive 저장의 fire-and-forget는 Vercel 함수 응답 후 종료로 메시지 유실 위험 → 내구성 위해 동기 유지, PROGRESS.md)

## Agent Code/Codex 사이드바·자동저장 (iter 9, autopilot)
- [x] C1. (cc.html·codex.html) 데스크톱 사이드바(세션/대화 패널) **기본 접힘**으로 진입 → 메인 코딩 영역 넓게. 햄버거(☰) 토글, 마지막 상태 localStorage(cc_sidecollapsed/codex_sidecollapsed) 기억. 모바일 드로어는 영향 없도록 CSS 무효화. (jsdom 데스크톱 기본접힘·토글영속·모바일안전 검증)
- [x] C2. (cc.html·codex.html) 작업 완료 시 결과 전문을 Google Drive **StellaGPT/0download**에 `{앱명}_{YYYYMMDD_HHMMSS}.txt`(내용=`[요청] 헤더`+빈줄+결과)로 자동 저장 + 성공/실패 토스트. 기존 Drive OAuth 재사용: lib/drive-files.mjs에 `saveTextToDrive`(+순수헬퍼 txtFileName/txtContent/tsKST) 추가, `/api/cc/save-drive`에 text 모드 추가(세션 불필요, 신규 라우트 0). codex=StellaCodex(매 응답), cc=StellaAgentCode(세션 완료 시 transcript). (헬퍼 유닛 7/7 + jsdom codex 페이로드/토스트 검증)
- [x] C3. (cc.html·codex.html) 모바일 햄버거(☰) 풀-토글: 누르면 **☰만 남기고** 상단(제목·앱아이콘·nav·세션·풀스크린)+하단 컨트롤(모델/테마/예산/OMC, 빨강 표시)까지 전부 숨겨 개발 영역 최대화, 다시 누르면 원래대로 복귀. 프롬프트 입력줄은 유지(사용성). cc-navhidden 상태에 `.top h1`·`.barwrap .ctl` display:none 추가. (jsdom 토글 default→show→hide 검증, 양 앱)

## 인증·전송·UI 복구 (iter 11, autopilot)
- [x] A1. (인증) 전원 로그인·관리자 인증 복구. 진단: 회원계정이 Google Drive(auth/users/*.json) 단독 저장 → Drive 토큰 만료/콜드스타트 시 전원 로그인 실패(401 "가입 정보가 없습니다"), yesblue0342는 env/하드코딩 비번이 없어 Drive 레코드 없으면 로그인 불가. 수정: (1) `ADMIN_PASSWORD`(env) 통과 경로 추가(approval.adminPasswordOk) → auth.js·admin-approvals.js에서 yesblue0342+env로 Drive 없이 관리자 로그인. (2) Azure SQL dbo.users에 password_hash 포함 영속 저장(ensureUsersTable ALTER ADD 가드, ADD-only로 기존 데이터 보존), 로그인은 Drive 우선→없으면 Azure 폴백, Drive 로그인 성공 시 Azure 백필. (핸들러 실호출 테스트 6건 포함 75/75) · [!] Vercel에 `ADMIN_PASSWORD` 환경변수 설정 필요(미설정 시 env-admin 경로는 건너뛰고 admin/admin·Drive레코드 폴백만 동작).
- [x] A2. (Stella Talk) 전송 실패(재전송만) 복구. 진단: sendTextToServer가 단일 시도 후 즉시 'failed' 표시 → 일시 타임아웃(504)/끊김도 바로 수동 재전송 요구. Drive 접근은 googleapis가 access token 자동 리프레시(lib/drive-utils OAuth2 setCredentials) → 토큰 만료는 자동 처리, refresh token 폐기만 인프라 이슈. 수정: 지수 백오프 자동 재시도(1s/2s/4s, 최대 3회) — 재시도 대상=네트워크(0)/408/429/5xx, clientId 동일로 서버 dedup(중복 없음), 상태 'sending' 유지. 소진/비재시도(401·403·앱거절)에서만 '재전송' 표시. 실패 status 진단 로깅(status·attempt·body). 재연결(online) 자동 flush는 기존 유지. (정책·시뮬 테스트 7건 포함 82/82) · [!] Drive refresh token 폐기 시 서버 5xx→재시도 소진→재전송 (env GOOGLE_REFRESH_TOKEN 재발급 필요, 인프라). Azure-우선 메시지 ack는 서버리스 응답후 종료로 메시지 유실 위험이라 미적용(내구성 우선).
- [x] A3. (Stella GPT) 로그인 버튼 파란/네이비 강조색 제거 → 테마색 매칭. `.primary` 하드코딩 `#0f172a`(라이트 네이비) → `var(--soft)`+`var(--ink)`+`var(--line)` 테두리(주변 입력/탭과 동일 톤), 다크는 `body.dark .primary{#21262d}`로 명시. 동일 패턴 파란 링크 `.link-btn` `#2563eb` → `var(--muted)`(+다크 `#8b949e`). 양 모드 확인. (line 27 `#2563eb`는 드래그 아웃라인이라 제외)
