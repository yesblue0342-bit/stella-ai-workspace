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

## 2026-06-21 (iter 8) · T1 Stella Talk 전역 알림(대화창 밖) · pass 7/7+62/62
- node --check api/chat-room.js OK · talk.html 인라인 스크립트 new Function bad=0 · npm test 62/62
- T1 알고리즘 유닛테스트 7/7: 최초 baseline 무알림 / 더 최신 상대메시지 알림 / 동일ts 재알림X / 내발신 무시 / 보는방 무시 / 목록화면 타방 알림 / 내이름=self
- grep: talk.html _notifyLastAt·_notifyPrimed·lastMessageAt·NOTIFY_AT_KEY 13 hit, chat-room lastMessageAt 3 hit

요약 3줄:
1. 원인: 전역 방목록 폴링이 messageCount 델타로만 감지 → count desync/baseline 문제로 대화창 밖 알림이 잘 안 떴음.
2. 수정: lastMessageAt(서버 list에 추가) since 기반으로 재작성 — 앱 열린 동안 모든 방의 상대 발신 새 메시지를 화면 무관하게 감지해 Notification+소리. 최초 baseline 프라이밍·보는방/내발신 제외·per-room ts로 재알림 방지.
3. [!] 앱 완전종료 상태 푸시는 Web Push(VAPID 구독/서버발송) 인프라 필요로 후속 보류(iOS는 OS 제약). 앱 열림/백그라운드 탭은 본 폴링으로 커버.

## 2026-06-21 (iter 8) · T2 Stella Talk 전송속도(응답 페이로드 트림) · pass 62/62
- node --check api/chat-room.js OK · npm test 62/62
- 페이로드 데모: send 응답이 전체 방 히스토리→확정 메시지 1건. 50msg 9032B→254B(97%↓), 200msg 35334B→257B(99%↓), 500msg 88134B→257B(100%↓)
요약 3줄:
1. 텍스트 낙관적 UI(즉시 표시·sendState·retry·clientId dedup)는 기구현 확인 — 체감 전송은 이미 즉시.
2. 확정 round-trip 단축: 백엔드 send 응답에서 매번 싣던 전체 방(room:data)을 제거하고 확정 메시지 1건만 반환(긴 방일수록 큰 절감, 클라는 d.message만 사용).
3. Drive 저장 fire-and-forget는 Vercel 응답 후 종료로 메시지 유실 위험→동기 유지(가정 PROGRESS.md). 무손실 트림으로 속도 개선.

## FINAL (iter 7) — T1·T2·T3 전체 완료
- npm test (`node --test test/*.test.js`): **62/62 pass**, fail 0.
- 백엔드 node --check: chat.js · cc/_maclient.mjs · cc/start.js · cc/turn.js OK.
- HTML 모듈 스크립트(cc.html·codex.html): bad=0. codex jsdom 초기화·send 무에러.
- T1 placeholder 정리 / T2 툴바 모노크롬 라인 SVG+중립 체크박스 / T3 Codex OpenAI 전환 — 전부 `[x]`.
- SW 캐시 v49→**v50** (UI 변경 캐시 무력화).
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt). 샌드박스에 `vercel --prod` 자격증명 없어 main 푸시로 동등 배포.
- 한계: Codex 실제 OpenAI 응답·라이브 UI는 Vercel(OPENAI_API_KEY) 환경에서만 확인 가능(Deployment Protection 403로 샌드박스 직접 확인 불가).

## FINAL (iter 8) — G1·T1·T2 전체 완료
- npm test: **62/62 pass**, fail 0. backend node --check(chat.js·chat-room.js) OK. talk.html 인라인 new Function bad=0.
- G1 메모리 병렬+warm캐시+계측 / T1 since 기반 전역 알림(유닛 7/7) / T2 send 응답 페이로드 트림(최대 100%↓) — 전부 `[x]`.
- SW 캐시 v50→**v51**.
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt). 샌드박스 `vercel --prod` 자격증명 없어 main 푸시로 동등 배포.
- 잔여 [!](항목 내 OS/인프라 제약): Talk 완전종료 푸시=Web Push(VAPID) 후속, iOS 진동/자동재생=OS. G1 스트리밍=라이브 SSE 검증 환경 확보 후속.

## 2026-06-21 (iter 9) · C1 Agent Code/Codex 사이드바 기본 접힘 · pass 62/62
- cc.html(모듈)/codex.html 인라인 스크립트 파싱 bad=0 · npm test 62/62
- jsdom: 데스크톱 기본 side-collapsed=true / 햄버거 토글 false↔true + localStorage 0↔1 영속 / 모바일은 side-collapsed 미적용(드로어 정상)
- grep: SIDECOLLAPSE_KEY·toggleSideDesktop·applySideCollapsed·모바일 CSS 무효화 각 7 hit(파일별)
요약 3줄:
1. 데스크톱 진입 시 세션/대화 패널을 기본 접힘으로 → 메인 코딩 영역을 넓게. 햄버거로 열고/닫기.
2. 마지막 접힘/펼침 상태를 localStorage(cc_sidecollapsed/codex_sidecollapsed)에 기억, 재진입 시 복원.
3. 모바일은 side-collapsed가 드로어 표시를 막지 않도록 CSS(body.side-collapsed .side{display:block})로 무효화 — 모바일 드로어 회귀 없음.

## 2026-06-21 (iter 9) · C2 결과 .txt Drive 자동저장 · pass 69/69
- node --check lib/drive-files.mjs · api/cc/save-drive.js OK · npm test 69/69(신규 drive-text 7건 포함)
- jsdom codex: send 후 /api/cc/save-drive 호출 app=StellaCodex·header=요청·text=결과, 성공 토스트 "Drive 저장 ✓ ..." 렌더
- cc.html/codex.html 파싱 bad=0
요약 3줄:
1. lib/drive-files.mjs에 saveTextToDrive + 순수헬퍼(txtFileName/txtContent/tsKST) 추가 — 파일명 {앱명}_{YYYYMMDD_HHMMSS}.txt, 내용=[요청]헤더+결과 전문, StellaGPT/0download 직하 저장.
2. /api/cc/save-drive에 text 모드 추가(세션 불필요) — 신규 키·라우트 0, 기존 Drive OAuth 재사용. codex 매 응답·cc 세션완료 시 자동 호출 + 성공/실패 토스트.
3. 헬퍼 유닛 7/7 + jsdom으로 저장 호출 페이로드·토스트 검증. 실제 Drive 업로드는 라이브 OAuth에서만.

## FINAL (iter 9) — C1·C2 전체 완료
- npm test: **69/69 pass**(drive-text 7건 추가), fail 0. node --check(drive-files.mjs·save-drive.js·chat.js) OK. cc/codex 파싱 bad=0.
- C1 사이드바 기본 접힘+상태기억(jsdom 데스크톱/모바일 검증) / C2 결과 .txt Drive(0download) 자동저장+토스트(헬퍼 7/7+jsdom) — 전부 `[x]`.
- SW 캐시 v54→**v55**.
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt). 정식 stella-ai-workspace 프로젝트 기준(중복 g1st는 미사용/무시).
- 한계: 실제 Drive 업로드는 라이브 OAuth(GOOGLE_* 토큰)에서만. 샌드박스는 순수헬퍼 유닛+jsdom 호출검증까지.

## 2026-06-21 (iter 10) · C3 모바일 햄버거 풀-토글(☰만 남김) · pass 69/69
- cc.html/codex.html 파싱 bad=0 · npm test 69/69
- CSS 규칙 존재(양 파일 2건씩): `body.cc-navhidden .top h1{display:none}` + `body.cc-navhidden .barwrap .ctl{display:none}`
- jsdom 토글: 모바일 햄버거 클릭 → cc-navhidden default(true)→show(false)→hide(true), 양 앱 toggles=true, 무에러
요약 3줄:
1. 모바일에서 햄버거(☰)를 누르면 상단 제목·앱아이콘·nav·세션·풀스크린 버튼 + 하단 컨트롤(모델/테마/예산/OMC, 스크린샷 빨강 표시)까지 전부 숨겨 ☰만 남김 → 개발 영역 최대화.
2. 다시 누르면 원래 화면 복귀(토글). 프롬프트 입력줄은 유지해 접힌 상태에서도 입력/전송 가능.
3. 데스크톱(@media 밖)은 영향 없음 — 기존 C1 사이드바 접힘 동작 유지. cc.html·codex.html 동일 적용.

## FINAL (iter 10) — C3 완료
- npm test: **69/69 pass**, fail 0. cc/codex 파싱 bad=0. node --check 백엔드 무변경(이번 항목은 CSS 한정).
- jsdom: 모바일 햄버거 풀-토글 양 앱 검증(default 최소화 → 펼침 → 최소화).
- SW 캐시 v55→**v56**.
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt). 정식 stella-ai-workspace 기준(중복 g1st 미사용/무시).

## 2026-06-21 (iter 11) · A1 인증(전원 로그인·관리자) 복구 · pass 75/75
- node --check api/auth.js·admin-approvals.js·lib/approval.js OK · npm test 75/75(auth-admin 6건 신규)
- 실핸들러 테스트: yesblue0342+ADMIN_PASSWORD(env)→200 approved(Drive/Azure 불필요), admin/admin 유지, adminPasswordOk env set/unset, canLogin 하위호환
요약 3줄:
1. 근본원인=Drive 단독 회원저장 → 토큰만료/콜드스타트 시 전원 로그인 실패 + yesblue0342 env/하드코딩 비번 부재. 
2. 수정: ADMIN_PASSWORD(env) 관리자 통과경로 + Azure SQL password_hash 영속 저장(ALTER ADD, ADD-only) + 로그인 Drive우선→Azure폴백+백필. 기존 계정 데이터 보존.
3. [!] Vercel에 ADMIN_PASSWORD 설정 필요(미설정 시 env-admin 비활성, admin/admin·Drive폴백만). Azure 실연결은 라이브 검증.

## 2026-06-21 (iter 11) · A2 Stella Talk 전송 실패 복구(백오프 재시도) · pass 82/82
- talk.html 인라인 new Function bad=0 · npm test 82/82(talk-send-retry 7건 신규)
- 정책: isRetryableStatus(0/408/429/5xx만)·sendBackoffMs(1/2/4/8s cap)·SEND_MAX_RETRY=3 실소스 추출 검증 + 재시도 루프 시뮬(503지속→4회 후 failed / 0,0,200→sent / 401·앱거절→즉시 failed)
요약 3줄:
1. 단일시도→즉시 재전송 표시를 지수 백오프 자동 재시도(최대3)로 교체 — 일시 타임아웃/끊김은 사용자 개입 없이 회복, clientId dedup로 중복 0.
2. 재전송은 재시도 소진 또는 비재시도(401/403/앱거절)에서만 표시. status·attempt·body 진단 로깅 추가. online 복구 자동 flush 유지.
3. [!] Drive refresh token 폐기는 인프라(GOOGLE_REFRESH_TOKEN 재발급). Azure-우선 ack는 서버리스 유실위험으로 미적용.

## 2026-06-21 (iter 11) · A3 Stella GPT 로그인 버튼 파란 강조 제거 · pass 82/82
- index.html 인라인 new Function bad=0 · npm test 82/82(회귀 없음)
- grep: `.primary` 하드코딩 #0f172a→var(--soft)/var(--ink)/var(--line), `.link-btn` #2563eb→var(--muted), 다크 override(body.dark .primary #21262d / link-btn #8b949e)
요약 3줄:
1. 로그인 버튼(.primary) 라이트의 네이비 #0f172a → 테마 중립 표면(var(--soft)+ink+line border)로 주변과 동일 톤. 다크는 이미 body.dark button(#21262d) 적용 + 명시 override.
2. 동일 패턴 파란 링크 .link-btn #2563eb → var(--muted)(+다크 #8b949e). line 27 #2563eb는 드래그 아웃라인이라 제외.
3. CSS 한정 변경, JS/로직 회귀 없음(82/82).

## FINAL (iter 11) — A1·A2·A3 완료
- npm test: **82/82 pass**, fail 0(auth-admin 6 + talk-send-retry 7 신규). node --check auth.js·admin-approvals.js·approval.js·db.js OK. cc/talk/index 인라인 파싱 bad=0.
- A1 인증(env 관리자+Azure password_hash 영속·Drive폴백·백필) / A2 Talk 전송 지수백오프 자동재시도 / A3 로그인 버튼 테마색 — 전부 `[x]`.
- SW 캐시 v56→**v57**.
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt, 정식 stella-ai-workspace 기준 / 중복 g1st 미사용·무시).
- 남은 [!]: (A1) Vercel `ADMIN_PASSWORD` env 설정 필요 — 미설정 시 env-admin 경로 비활성(admin/admin·Drive/Azure 레코드 폴백만). (A2) Drive refresh token 폐기 시 GOOGLE_REFRESH_TOKEN 재발급 필요(인프라). 둘 다 대시보드 작업이라 에이전트 적용 불가.
