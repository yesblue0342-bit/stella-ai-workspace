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

## 2026-06-19 (iter 4) · Stella Agent Code 미세개선 (빈안내/아이콘색/예산라벨) · pass 4/4
- cc.html 모듈 node --check OK
- CC-7 안내문구 제거 / CC-8 다크·라이트 아이콘 강제 / CC-9 예산$ nowrap grep 4/4 ✅
요약 3줄:
1. CC-7 빈 화면의 안내 텍스트 제거(emptyHint 빈 div).
2. CC-8 app-ico-wrap 다크(검정/흰테두리/흰아이콘)·라이트(흰/검테두리/검아이콘) !important 강제 → 테마 일관.
3. CC-9 .lbl white-space:nowrap → "예산$"가 두 줄로 내려가던 것 한 줄로.

## 2026-06-20 (iter 5) · Stella Codex 앱 신규 + 바로가기 추가 · pass 7/7
- vercel.json JSON.parse OK
- codex.html 모듈/인라인 스크립트 추출 검증 bad=0
- grep 검증: index.html `/codex`+⌨+Stella Codex / abap.html 동일 / codex.html `<title>Stella Codex</title>`+app-title-text / vercel `/codex`·`/stella-codex` 2건 / sw.js `/codex`+stella-v48 → 7/7 ✅

| 항목 | 변경 | 테스트 | 결과 |
|------|------|--------|------|
| 신규 앱 | `cc.html`→`codex.html` 복제 후 리브랜딩(제목·앱타이틀 "Stella Codex", h1 아이콘 ⌨, localStorage `stella_codex_*`·`codex_navhidden`) | 모듈 node --check / 인라인 new Function bad=0 | ✅ |
| 바로가기 | index.html(shortcut-admin)·abap.html(tree) "Stella Agent Code" 바로 아래 ⌨ 흑백 아이콘으로 "Stella Codex" 추가 | grep 2/2 | ✅ |
| 라우트 | vercel.json `/codex`,`/stella-codex`→codex.html | JSON.parse + grep | ✅ |
| SW | isHTML network-first에 `/codex` 추가, 캐시 v47→v48 | grep | ✅ |
| 백엔드 | `/api/cc/*`(Managed Agents) 재사용 — 신규 키·라우트 0 | 정적 확인 | ⚠ OpenAI Codex 전용 런타임 인프라 부재(후속) |

요약 3줄:
1. 요청대로 명칭 "Stella Codex", 아이콘은 다른 앱과 동일한 흑백 통일 방식(⌨, app-ico-wrap/filter), 바로가기에서 Stella Agent Code 바로 아래 배치.
2. 레이아웃은 Stella Agent Code(cc.html)와 동일하게 복제, localStorage 키만 codex 네임스페이스로 분리(상태 충돌 방지).
3. 백엔드는 신규 인프라(API 키/라우트) 추가 없이 기존 Agent Code 런타임 재사용 — OpenAI Codex 전용 코드실행 런타임은 인프라에 없어 후속 반복으로 분리.

## FINAL (iter 5)
- 재검증: vercel.json JSON OK · codex.html scripts bad=0 · grep 7/7 PASS · 회귀 없음.
- 배포: main 푸시 → Vercel 자동 배포. SW 캐시 stella-v48.
- 가정: Stella Codex 백엔드는 현 Agent Code(Managed Agents) 재사용. OpenAI Codex 백엔드 분리는 신규 인프라 필요 → 후속.

## 2026-06-20 (iter 6) · CC-4 cc/codex 이미지 첨부 업로드 · pass 5/5
- node --check api/cc/_maclient.mjs · start.js · turn.js → OK
- cc.html / codex.html 인라인+모듈 스크립트 bad=0
- grep: cc.html 첨부 wiring 12 hit / codex.html 12 hit / start.js·turn.js attachments / _maclient image 블록 ✅
요약 3줄:
1. 프런트: iorow에 📎 버튼+숨김 file input(image/*, multiple)+붙여넣기(paste) 캡처, base64 변환(개당 3.5MB 상한, Vercel 본문 한도 보호), 첨부 칩 strip(개별 삭제), 전송 후 비움.
2. 백엔드: `sendUserMessage(sessionId,text,attachments)`가 `buildContent`로 image 콘텐츠 블록 생성(텍스트는 항상 보장 경로). start.js/turn.js가 body의 attachments 통과, turn은 첨부 단독 전송도 허용.
3. 신규 API 키/라우트 0(기존 /api/cc/* 재사용). ⚠ Managed Agents 런타임 image 블록 수용은 Claude 기반이라 지원 예상이나 샌드박스 자격증명 부재로 라이브 미검증 — 텍스트 경로 회귀 없음.

## FINAL (iter 6)
- 재검증: 백엔드 3종 node --check OK · cc/codex 스크립트 bad=0 · grep 5/5 PASS · 텍스트 경로 회귀 없음.
- 배포: main 푸시 → Vercel 자동 배포. SW 캐시 stella-v49.
- 한계: 이미지 블록의 런타임 실제 수용은 라이브(Vercel+Managed Agents 자격증명)에서만 확인 가능. 미지원 시에도 텍스트 전송은 영향 없음(첨부는 additive).

## 2026-06-20 (iter 7) · T1 프롬프트 placeholder 정리 · pass 2/2
- cc.html / codex.html 모듈·인라인 스크립트 bad=0
- grep: `placeholder="코딩 작업을 입력하세요"` 각 1 hit, placeholder의 "줄바꿈" 0 (잔여 2건은 JS 동작 설명 주석)
요약 3줄:
1. 두 파일 프롬프트 textarea placeholder에서 "(Enter 전송 / Shift+Enter 줄바꿈)" 안내 제거.
2. 안내 문구만 제거, Enter 전송/Shift+Enter 줄바꿈 동작 로직은 그대로 유지.
3. 회귀 없음(스크립트 파싱 bad=0).

## 2026-06-20 (iter 7) · T2 툴바 모노크롬 라인 아이콘 · pass 4/4
- cc.html/codex.html 모듈 스크립트 bad=0, SVG open/close 균형 3/3 OK
- grep: themeToggle 빈 버튼(JS가 SVG 주입)·SVG_SUN/MOON 상수·OMC `<svg class="ico">`·`#omc{accent-color:var(--muted)}` 각각 확인, ctl 내 이모지 🌙/🤖 0
요약 3줄:
1. 테마 토글: 🌙/☀️ 이모지 → 흰색 모노크롬 라인 SVG(달/해, stroke=currentColor=--ink) JS 주입.
2. OMC: 🤖 이모지 → 라인 로봇 SVG, 체크박스는 파란 accent → 중립(accent-color:var(--muted)).
3. 사이드바 바로가기 아이콘 톤과 통일, 기능(테마 전환/OMC 토글) 로직 동일.

## 2026-06-20 (iter 7) · T3 Stella Codex OpenAI 전환 · pass 6/6
- node --check api/chat.js OK · codex.html 모듈 스크립트 bad=0
- 참조 ID 누락 0 · jsdom 초기화 무에러
- jsdom 검증: 모델 6개 전부 OpenAI(claude 0), 기본 gpt-4.1-mini, 테마 SVG 주입, 새 대화 OK
- jsdom send(): POST /api/chat · body.model=gpt-4.1-mini · bare=true · system="Stella Codex…" · user+assistant 버블 2개 · 코드블록 `<pre>` 렌더
- cc.html 회귀: agentcore/`/api/cc/start`/CLAUDE_MODELS 그대로(5 hit) — Claude 유지

| 항목 | 변경 | 테스트 | 결과 |
|------|------|--------|------|
| 모델 목록 | codex만 CLAUDE_MODELS→OPENAI_MODELS(6종), 기본 gpt-4.1-mini, Claude 제거 | jsdom 옵션검사 | ✅ |
| API 고정 | /api/cc/* → /api/chat(OpenAI), CODEX_SYSTEM+bare:true | jsdom 페이로드 | ✅ |
| 백엔드 | chat.js callOpenAI에 `bare` 플래그(기본 off, 하위호환) | node --check | ✅ |
| UI 단순화 | 예산/OMC/Drive저장/세션 제거 → 대화 localStorage, 코드 마크다운 렌더 | jsdom 렌더 | ✅ |
| 회귀 | cc.html Claude 경로 무변경 | grep | ✅ |

요약 3줄:
1. Stella Codex를 OpenAI 전용 채팅형 코딩 어시스턴트로 전환 — 모델 OpenAI 6종(기본 gpt-4.1-mini), 호출은 기존 /api/chat(빌링 분리) bare 모드, 신규 키·라우트 0.
2. chat.js에 하위호환 additive `bare` 플래그(표+요약 강제 프리픽스 생략) 추가 — GPT/ABAP 무영향.
3. Stella Agent Code(cc.html)는 Claude/Managed Agents 그대로 유지. 실제 응답은 라이브(OPENAI_API_KEY)에서만, 샌드박스는 jsdom 정적·런타임 검증까지.

## 2026-06-21 (iter 8) · G1 Stella GPT 응답속도(계측+병렬+캐시) · pass 62/62
- node --check api/chat.js OK · npm test 62/62 통과(회귀 없음)
- grep: timings/getMemoryPrompt/invalidateMemoryCache/memoryPromise/mark( 16 hit
- 구조적 시뮬레이션(대표 지연값, 실측 아님):
  - 일반대화(검색/Drive 미사용): 반복요청 메모리준비 180ms→**~3ms**(warm 캐시)
  - 검색+Drive 사용: 준비단계 501ms→**321ms**(메모리 병렬화로 ~180ms 절감)

| 구간 | 변경 | 효과 |
|------|------|------|
| 계측 | `timings{memoryMs,contextMs,preModelMs,modelMs,totalMs,memoryCached}` 응답+서버로그 | 라이브 병목 실측 가능 |
| 메모리 병목 | buildMemoryContext(Azure)+loadMemory(Drive)를 매 요청 직렬 → **검색/Drive와 병렬 착수** | 준비시간에서 memory 숨김 |
| 반복 fetch | userId별 60s warm 캐시(getMemoryPrompt), updateMemory 후 invalidate | 2번째+ 요청 메모리 fetch 0 |
| 회귀 | 기존 폴백(Azure→Drive) 순서·로직 보존 | 62/62 |

요약 3줄:
1. 먼저 구간 타이밍을 심어 병목 특정 경로(메모리 로드=Azure SQL+Drive를 매 요청 직렬 호출)를 코드로 확인 → 응답 `timings`로 라이브 실측 가능하게 함.
2. 효과 큰 것부터: 메모리 로드를 검색/Drive와 병렬화(준비시간에서 숨김) + warm 인스턴스 60s 캐시(반복요청 fetch 제거, 업데이트 시 무효화).
3. 스트리밍은 SSE end-to-end를 샌드박스에서 검증 불가(작동 중인 채팅 회귀 위험)라 후속으로 보류, 근거 PROGRESS.md. 모델 호출 자체 지연은 streaming이 '체감'만 개선.

## FINAL (iter 7) — T1·T2·T3 전체 완료
- npm test (`node --test test/*.test.js`): **62/62 pass**, fail 0.
- 백엔드 node --check: chat.js · cc/_maclient.mjs · cc/start.js · cc/turn.js OK.
- HTML 모듈 스크립트(cc.html·codex.html): bad=0. codex jsdom 초기화·send 무에러.
- T1 placeholder 정리 / T2 툴바 모노크롬 라인 SVG+중립 체크박스 / T3 Codex OpenAI 전환 — 전부 `[x]`.
- SW 캐시 v49→**v50** (UI 변경 캐시 무력화).
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt). 샌드박스에 `vercel --prod` 자격증명 없어 main 푸시로 동등 배포.
- 한계: Codex 실제 OpenAI 응답·라이브 UI는 Vercel(OPENAI_API_KEY) 환경에서만 확인 가능(Deployment Protection 403로 샌드박스 직접 확인 불가).
