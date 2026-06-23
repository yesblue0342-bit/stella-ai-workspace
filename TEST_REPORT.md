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

## 2026-06-21 (iter 12) · A1 회귀 — 저장소 오류 마스킹 제거 · pass 84/84
- node --check api/auth.js·admin-approvals.js OK · npm test 84/84(회귀 테스트 2건 신규)
- 실핸들러: 저장소 장애 시 로그인 503 AUTH_STORE_UNAVAILABLE(구: 401 "가입 정보 없음" 둔갑) / admin·admin·ADMIN_PASSWORD 200(Drive 불필요)
요약 3줄:
1. 회귀 근본=공용 Drive 조회 실패(토큰/FOLDER_ID)를 readUser catch{}가 "가입 정보 없음"으로 둔갑 → 관리자·회원 동시 장애 원인 은폐.
2. 수정: not-found(401)와 저장소오류(503)를 구분(auth.js·admin-approvals.js), env-admin/Azure 폴백으로 로그인 복구. 데이터 무손상.
3. [!] Vercel env: GOOGLE_DRIVE_FOLDER_ID/GOOGLE_REFRESH_TOKEN/ADMIN_PASSWORD 중 누락분 설정 시 즉시 정상.

## FINAL (iter 12) — 전수 검사 P1~P5 완료
- npm test: **84/84 pass**. node --check 전 api/lib OK. HTML 19 인라인 스크립트 파싱 bad=0. /api 엔드포인트 71개 끊김 0.
- P1 구문 0/0 · P2 시크릿 0/0 · P3 인프라 0/0(env 외) · P4 스모크 0/0 · P5 84/84.
- A1 회귀 수정(저장소 오류 마스킹 제거) 포함. SW 캐시 v57→**v58**.
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt, 정식 stella-ai-workspace / 중복 g1st 무시).
- 보류[!]: Vercel env GOOGLE_DRIVE_FOLDER_ID/GOOGLE_REFRESH_TOKEN/ADMIN_PASSWORD(인프라).

## 2026-06-21 (iter 13) · SB1 Agent Code/Codex 전송버튼 중립색 · pass 84/84
- cc.html/codex.html 파싱 bad=0 · npm test 84/84(회귀 없음, CSS 한정)
- grep: var(--send)/var(--cancel) 0건(녹/빨 제거), #sendBtn neutral 규칙 양 파일 1건씩. 토큰 라이트(#f3f4f6/#111827/#e5e7eb)·다크(#161b22/#e6edf3/#21262d) 확인
요약 3줄:
1. 전송(녹색)·중단(빨강) 버튼을 var(--card) 표면+var(--ink) 텍스트+var(--line) 테두리 중립색으로 교체 — 주변 모노크롬 아이콘과 동일 톤.
2. 라이트=연회색/검정텍스트, 다크=어두운표면/밝은텍스트로 테마 자동 전환, 강조 컬러 없음(눈에 안 띄게).
3. cc.html·codex.html 동일 적용. SW 캐시 v58→v59.

## FINAL (iter 13)
- npm test 84/84. cc/codex 파싱 bad=0. 전송/중단 버튼 강조색 제거 완료(양 모드).
- 배포: main 푸시 → Vercel 자동 배포(team: stella-gpt). SW v59.

## 2026-06-21 (iter 14) · Drive 독립 로그인(allowlist+env 비번) · pass 99/99
- node --check lib/approval.js·api/auth.js·api/admin-approvals.js OK · npm test 99/99(auth-resilience 18건 신규)
- 핸들러 실호출(Drive 0회): allowlist+평문→200 / allowlist+salt:hash→200 / 틀린비번→401 / MEMBERS 미설정→503 MEMBERS_UNSET / 비번없음→503 MEMBER_PW_UNSET / 비-allowlist→403 NOT_ALLOWLISTED / signup→403 SIGNUP_DISABLED / admin·admin은 env설정시 차단
- 순수함수: resolveAllowedId(id·email매핑·null)·getMemberPw(문자열/객체.pw)·membersConfigured·adminPasswordConfigured·verify(평문/salt:hash)
요약 3줄:
1. 로그인 판정에서 Drive를 전혀 읽지 않도록 allowlist 분기를 login 최상단에 삽입 — GOOGLE_REFRESH_TOKEN 만료와 무관하게 정해진 회원 항상 로그인. 비번은 env STELLA_MEMBERS(평문/salt:hash) 조회.
2. 신규 가입 403 SIGNUP_DISABLED(Drive 쓰기 제거). admin/admin 부트스트랩은 STELLA_MEMBERS/ADMIN_PASSWORD 설정 시 비활성(공개 레포 구멍 차단). 기존 Drive/Azure 경로는 비-allowlist·members미설정 시 하위호환으로 유지.
3. 비밀값은 소스/테스트 미포함(허용 ID 식별자만 소스, 비번은 Vercel env). 기존 회원 데이터 ADD-only·무삭제.

## FINAL (iter 14)
- npm test **99/99 PASS**. 변경: lib/approval.js(allowlist 유틸), api/auth.js(Drive독립 로그인+signup차단+부트스트랩 보안), api/admin-approvals.js(부트스트랩 보안), test/auth-resilience.test.js(신규), test/auth-admin.test.js(부트스트랩 차단 반영), sw.js v60.
- 한 줄: 정해진 ID는 Drive 안 읽고 env 비번으로 로그인 → 구글 토큰 만료에도 로그인 항상 가능.

## 2026-06-21 (iter 15) · 단순 로그인 원복(승인/권한 체크 제거) · pass 84/84
- node --check api/auth.js·api/admin-approvals.js OK · npm test 84/84
- 핸들러 검증: admin/admin→200, 미존재/저장소오류→401(503 제거), yesblue0342+ADMIN_PASSWORD(선택)→200
요약 3줄:
1. readUser 오류 삼키기 원복(throw→null)로 503 AUTH_STORE_UNAVAILABLE 원천 제거. login의 driveErr/503 분기·canLogin 승인게이트 삭제 → 단순 조회→비번검증→성공.
2. signup status pending→approved + 즉시 성공 반환(중복검사·Drive 저장 유지). admin/admin 무조건 통과로 원복. iter14 allowlist/SIGNUP_DISABLED 블록 제거(단순 로그인 차단 요인).
3. 반영해 obsolete된 핸들러 테스트 정리(allowlist 테스트 파일 삭제, auth-admin 2건 단순동작으로 수정). approval.test.js 무수정. 데이터 ADD-only.

## FINAL (iter 15)
- npm test **84/84 PASS**. 변경: api/auth.js(단순 로그인/가입), api/admin-approvals.js(503/부트스트랩가드 원복), test/auth-admin.test.js(단순동작 반영), test/auth-resilience.test.js 삭제, sw.js v61.
- 한 줄: 오늘 추가한 승인게이트·503·pending·allowlist를 제거해 오늘 이전의 단순 로그인으로 원복(자격증명/Drive 정상 전제).

## 2026-06-21 (iter 16) · 하드코딩 화이트리스트 로그인 + admin + 내부에러 노출제거 + 유저ID 고정 · pass 94/94
- node --check api/auth.js·lib/login-allow.js OK · npm test 94/94(login-allow 10건 신규)
- a~e 결과: (a)allowlist 3개 ID 틀린/빈 비번 200✓ (b)yesblue0342 isAdmin true·role admin✓ (c)dmswn8712·mjlee isAdmin false✓ (d)에러 매핑/실패 메시지 금칙어 0·내부 error 필드 미노출✓ (e)동일 username→동일 user.id(대문자도 정규화 고정)✓
요약 3줄:
1. lib/login-allow.js(서버 전용): ALLOWLIST 3개 ID는 비번 무관(빈/틀림 포함) 즉시 200, Drive 호출 0. yesblue0342만 role:admin/isAdmin:true. 클라 소스에 명단 미노출.
2. 내부 노출 제거: auth.js 회원가입/핸들러 에러를 일반 문구("잠시 후 다시 시도해주세요.")+console.* 내부로그로 전환(금칙어 Drive/환경변수/env/경로/error필드 제거). 클라 authMsg도 일반화.
3. 권한: publicUser·admin 응답에 role/isAdmin 추가, 클라는 apiUser.isAdmin 직접 사용(Drive 권한조회 없음). 유저ID=username 고정(난수 없음)으로 채팅/프로젝트 orphan 방지. 회귀 0(기존 기능 무변경).

## FINAL (iter 16)
- npm test **94/94 PASS**(a~e 전수 통과). 변경: lib/login-allow.js(신규), api/auth.js(화이트리스트+에러 일반화+role/isAdmin), index.html(서버 isAdmin 사용+에러 일반화), test/login-allow.test.js(신규), sw.js v62.
- 한 줄: 정해진 3개 ID는 Drive 없이 비번 무관 즉시 로그인(yesblue0342=admin), 내부 구조 에러 비노출, 유저ID=username 고정.

## 2026-06-21 (iter 17) · Stella GPT 답변 유형 라우팅 + 표 온디맨드 + 마크다운 수정 · pass 101/101
- node --test test/router.test.mjs 7/7 · 전체 101/101 · node --check api/chat.js·lib/router.mjs OK · index 인라인 파싱 bad=0
- 라우팅: body.route(GPT 전용) 게이트 → needsWebSearch→gpt-4o+web_search(Responses API), 일반→gpt-4o-mini. 표는 wantsTable일 때만. ABAP/Codex route:true 0(영향 없음).
- 마크다운: renderAnswer가 marked+DOMPurify(js/stella-md.js) 우선 렌더, 실패 시 renderMarkdownLite 폴백 → **굵게 별표 새는 버그 수정**.
- STEP5 실증 스모크: 샌드박스에 OPENAI_API_KEY 없음 → 라이브 호출 불가. 순수함수/파싱(extractText '1승 1패')·게이트·파서까지 검증, 실제 검색 답변은 배포 후 사용자 환경에서 확인 필요.
요약 3줄:
1. /api/chat(공유)에 body.route 게이트로 Stella GPT만 답변 유형 라우팅 추가 — 실시간 질문은 web_search+gpt-4o로 환각 제거, 일반은 gpt-4o-mini로 빠르게.
2. 표는 "표로/테이블/비교표" 요청 시에만(buildSystemPrompt table 분기), 그 외 대화형 산문. 강제 표 프리픽스 미사용. 메모리(kh_memory)·Drive 컨텍스트는 extra로 보존.
3. 마크다운을 marked+DOMPurify로 렌더해 **굵게**가 별표로 새던 버그 수정(폴백 유지). 응답 키(text)·스트리밍 여부·타임아웃/에러 처리 보존.

## FINAL (iter 17)
- node --test 101/101 PASS. 변경: lib/router.mjs(신규), api/chat.js(callResponses+라우팅 게이트), index.html(route:true+marked/DOMPurify CDN+renderAnswer), js/stella-md.js(신규), test/router.test.mjs(신규), sw 캐시 +1.
- 한 줄: Stella GPT만 실시간↔일반 라우팅+표 온디맨드+마크다운 정상 렌더, 다른 앱 무영향.

## 2026-06-21 (iter 18) · 회귀복원(복사/표) + 검색 모델결정화(web_search 상시) · pass 104/104
- node --test router 5/5 + exporters 5/5 + 전체 104/104 · node --check api/chat.js·lib/router.mjs·lib/exporters.mjs OK · stella-md 파싱 OK
- 검색: needsWebSearch 게이트 제거→web_search 상시(gpt-4o), #구글드라이브 우선분기(needsDrive면 검색 미제공). 표 온디맨드·body.route 한정 유지(회귀 없음).
- 복원: marked 렌더 후 코드블록 복사 버튼+표 TSV 복사(stella-md.js addCopyButtons). Excel 실.xlsx 유지.
- STEP6 라이브 스모크: OPENAI_API_KEY 없어 실호출 불가 — "송도 맛집/월드컵/안녕/표" 실검증은 배포 후. 순수함수·파서·게이트는 테스트 통과.
요약 3줄:
1. 검색 정확도: 좁은 키워드 게이트 폐기, web_search를 모델이 항상 쓸 수 있게(맛집·장소 환각 제거, 출처 표기). #구글드라이브는 우선 분기.
2. 회귀복원: 마크다운 정상 렌더(marked) 위에 코드블록/표 복사 버튼 재부착. Excel은 이미 SheetJS 실파일이라 유지, lib/exporters.mjs로 테스트 가드.
3. 직전 개선 유지: 표 온디맨드·body.route Stella GPT 한정. 다른 앱 무영향.

## FINAL (iter 18)
- node --test 104/104 PASS. 변경: lib/router.mjs(v2), api/chat.js(검색 상시+drive 우선), js/stella-md.js(복사버튼 복원), lib/exporters.mjs(신규), test/router.test.mjs(v2)+test/exporters.test.mjs(신규), REGRESSION_AUDIT.md, sw +1.
- 한 줄: 맛집/실시간은 web_search로 정확히, 복사/엑셀 복원, 표 온디맨드 유지 — Stella GPT 한정.

## 2026-06-21 (iter 19) · 사이드바 9개 복원 + 회원승인 관리자메뉴 + 톤다운 · pass 104/104
- node --test 104/104(router 5+exporters 5 포함, 회귀 0) · node --check api/chat.js·lib/router.mjs·lib/exporters.mjs OK · index 인라인 파싱 bad=0
- 사이드바: 앱 바로가기 9개(Clover 추가, .shortcut-admin 해제) 전원 노출. 회원 승인=.admin-only(isStellaAdmin=role admin)만, FAB 숨김. 업데이트 색 #b45309→var(--muted).
- 테마: app-ico grayscale+dark invert로 라이트/다크 자동(🛡·🍀 모노크롬, 빨강/주황 제거). 검색/복사/렌더 영역 변경 0.
요약 3줄:
1. 앱 바로가기 9개 전원 노출 복원(Stella Clover 외부링크 추가, 관리자 게이트 해제) — 일반 사용자도 모든 앱 접근.
2. 회원 승인을 플로팅 FAB→사이드바 하단 "관리자" 섹션(.admin-only)으로 이동, 관리자(yesblue0342)에게만 노출·동작 유지.
3. 사이드바 컬러(주황 업데이트·빨강 방패) 제거→app-ico 모노크롬/테마토큰으로 다크·라이트 양쪽 자연스럽게. 검색/복사/Excel/렌더 회귀 0.

## FINAL (iter 19)
- node --test 104/104 PASS. 변경: index.html(사이드바 마크업+applyShortcutVisibility 셀렉터+head style), sw.js +1. (검색/복사/렌더 코드 0 변경)
- 한 줄: 9개 앱 바로가기 복원 + 회원 승인 관리자 전용 사이드바 메뉴 + 다크/라이트 모노크롬 톤다운.

## 2026-06-21 (iter 20) · Stella Talk 기능 전수 점검 · pass 6/6 (104/104 회귀 0)
- 구문: talk.html 인라인 new Function bad=0 · api/chat-room.js node --check OK
- 엔드포인트 매핑: 프론트 호출 action(get/read/typing/send/invite/leave/react/delete-message/list) 전부 백엔드 존재, 끊김 0
- 파라미터 정합: react{roomId,messageId,userId,emoji}·delete-message·read·typing·leave·invite·send 프론트↔백엔드 일치
- 단위테스트: talk-send-retry+friends+room-membership 18/18, 전체 104/104
- jsdom 로드: 런타임 null-ref 0
- **기능 실증(jsdom)**: 세션 주입→syncRoomListFromServer(list POST)→openRoom→sendMsg → action=send POST 발생(body roomId=r1·userId=u1·message·clientId 정상)+낙관적 화면 렌더 확인 → **SEND OK**
요약 3줄:
1. 구문·엔드포인트·파라미터·단위테스트·런타임로드·실제 전송 플로우까지 6개 검사 전부 통과 — 오류 없음.
2. 메시지 전송(낙관적 UI+clientId dedup+백오프 재시도)·방목록 동기화·이모지 반응·읽음/타이핑·삭제·나가기 경로 정상.
3. 수정 필요 항목 0 → 코드 변경 없음(배포할 기능 변경 없음). 라이브 Azure/Drive 응답은 사용자 환경에서 최종 확인.

## FINAL (iter 20)
- Stella Talk 전수 점검 6/6 + 전체 104/104 PASS. 발견된 오류 0 → 코드 수정 0.
- 한 줄: Stella Talk 정상 작동 확인(전송·동기화·반응·읽음/타이핑·삭제 경로), 회귀 없음.

## 2026-06-21 (iter 21) · 0Program GitHub 이중 저장 + 수정 루프 · pass 112/112
- node --test github-store 8/8 + 전체 112/112 · node --check lib/github-store.mjs·api/cc/save-drive.js OK · cc/codex 파싱 bad=0 · 소스 내 PAT 0
- 경로 toRepoPath(일반/확장자/한글/빈이름)·base64 라운드트립·PUT바디(create/update sha)·sha파싱 8/8
- 회귀: router/exporters 10/10(검색/표/복사 무영향)
요약 3줄:
1. lib/github-store.mjs(GET sha→base64→PUT upsert, GITHUB_TOKEN만) + 빈레포 부트스트랩. save-drive text 모드가 Drive 저장 직후 0Program에 비차단 upsert(실패 허용→Drive/응답 무영향).
2. load-github 액션 + 프론트 programName(대화 제목) 전송 → 같은 대화=같은 path=upsert로 수정 루프(Codex/Agent Code가 같은 소스 이어서 수정 가능).
3. 스모크는 샌드박스 GITHUB_TOKEN 부재로 미실행 → 배포 후 확인. 토큰은 코드/응답/로그 어디에도 미노출.

## FINAL (iter 21)
- node --test 112/112 PASS. 변경: lib/github-store.mjs(신규), api/cc/save-drive.js(upsert+load), cc.html·codex.html(programName), test/github-store.test.mjs(신규), sw +1.
- 한 줄: Agent Code/Codex 소스를 Drive+0Program 이중 저장, 같은 대화는 upsert로 수정 루프. Drive 비차단.

## 2026-06-22 (iter 22) · 0Program 토큰 env 폴백 정합 · pass 112/112
- node --check lib/github-store.mjs·api/cc/save-drive.js OK · node --test github-store 8/8 + 전체 112/112 · 소스 내 PAT 0
- ghToken() 폴백 6종(GITHUB_TOKEN/GH_TOKEN/GH_PAT/GITHUB_PAT/GITHUB_API_KEY/STELLA_GITHUB_TOKEN) 단건 주입 검증 6/6 OK + none→"" OK
- save-drive 게이트(load-github·text 이중저장) hasGhToken()로 교체 → 어떤 변수명이든 활성
요약 3줄:
1. ghHeaders가 process.env.GITHUB_TOKEN 직접참조 → ghToken() 폴백 함수로 교체(여러 PAT 변수명 호환, 새 토큰 발급/추가 없음). hasGhToken() export.
2. api/cc/save-drive.js 두 게이트(load-github 404가드, text 이중저장 가드)도 hasGhToken()로 통일 → Vercel에 어떤 이름으로 PAT가 있어도 0Program 저장 활성.
3. STEP G 실스모크(생성 PUT→update PUT→정리)는 **샌드박스 env에 PAT 부재(6종 전부 no)** 로 실행 불가 → 배포(Vercel env 존재) 후 0Program에서 생성/수정 1회 확인 필요. 토큰 문자열은 코드/로그/응답 어디에도 미노출.

## 2026-06-22 (iter 23) · 이미지 직접 분석(Vision) 수정 · pass 119/119
- node --check api/chat.js·lib/vision-format.mjs OK · node --test vision-format 7/7 + 전체 119/119(112→+7) · 소스 내 시크릿 0
- 블록 셰입 실검증: responses=input_image(문자열 image_url)·chat=image_url{url,detail}·claude=image{source.base64,media_type} 3종 정확 + mediaType(data URL 실제값) 보존
- 모델가드: gpt-4.1-mini 유지·gpt-4o 유지·텍스트전용→gpt-4o·claude-opus 유지·텍스트전용(claude)→claude-sonnet-4-6
요약 3줄:
1. 진단: 포맷은 이미 API별 일치했고 **실제 원인=routed(GPT) 경로가 이미지+web_search 동시 첨부**→툴 흐름으로 빠져 거부/빈응답→프론트 OCR 폴백. 더해 텍스트전용 모델 시 비전 미보장 리스크.
2. 수정: lib/vision-format.mjs(공유 util)로 3개 경로(callResponses/callOpenAI/callClaude) 이미지 블록 통일 + ensureVisionModel로 비전모델 보장. **이미지 있으면 web_search 미첨부(직접 비전 우선)**. 18MB 초과 용량 가드(한국어 안내).
3. OCR 폴백은 직접 비전 실패 시에만(프론트 callApi(true)→실패 시 callApi(false)) 유지, 정상 시 에러 메시지 없음. 프론트 무변경(데이터URL 그대로 전송), 백엔드만 정리 → 회귀 0.

## 2026-06-22 (iter 24) · 복사 버튼 테마 대응(다크=흰색/라이트=블렌드) · pass 119/119
- index.html·abap.html .copy-btn/.url-copy CSS만 변경(JS 무변경). new Function 인라인 JS 파싱 OK·CSS 규칙(라이트 블렌드/다크 흰색/url-copy) 3종 존재 검증·전체 119/119 회귀 0.
- sw v67→v68.
요약 3줄:
1. 코드블록/표 "복사" 핀(.copy-btn) + URL 옆 📋(.url-copy)을 테마 대응: 라이트=반투명 슬레이트+opacity .5로 주변과 블렌드(눈에 안 띄게), hover 시 또렷 → 사용성 보전.
2. 다크=흰색 핀(body.dark .copy-btn background:#fff), url-copy는 양 모드 투명+밝기 보정. 특이도 정상(body.dark .copy-btn 0,1,1 > .copy-btn 0,1,0).
3. 스코프: 이 버튼을 실제 렌더하는 GPT(index)·ABAP만 변경(codex/cc/talk/db/hub 미렌더). 답변복사(.msgCopyBtn)·기능 로직 무변경.

## 2026-06-22 (iter 25) · Stella Talk: 날짜 요일 + 백그라운드 Web Push · pass 128/128
- node --check kst-date/push-util/push-send/push-subscribe/chat-room/sw OK · npm test 103/103 + .mjs 25/25(총 128, +9) · talk.html new Function 파싱 OK · 시크릿 0 · package.json JSON 유효
- T1: lib/kst-date.js kstWeekday/kstWeekdayIndex/kstDateLabel(+test 5) · talk.html 날짜 구분선 toLocaleDateString에 timeZone:Asia/Seoul + weekday:'long' → "2026년 6월 22일 월요일"
- T2: lib/push-util.js(순수,+test 5) + api/push-subscribe.js(구독저장/공개키) + lib/push-send.js(web-push 동적import,env게이트) + chat-room send 훅(비차단) + talk.html subscribePush + sw push payload(title/roomId) 정렬
요약 3줄:
1. 날짜 옆 한국요일 표시(KST 기준, 자정경계 테스트 포함). 스크린샷의 "6월22일 월요일" 형태로 구분선 노출.
2. "앱 안 열어도 알림"=서버 Web Push(VAPID). 발신 시 chat-room이 멤버(발신자 제외)에게 푸시. **VAPID_PUBLIC_KEY/PRIVATE_KEY env 있을 때만 동작**, 없으면 완전 no-op → 현행 prod 영향 0. 키 추가 시 즉시 활성(web-push 의존성 추가, 빌드시 설치).
3. sendMsg는 원래 즉시 서버 전송이라 미수신 원인은 수신측 포그라운드 폴링뿐 → 백그라운드 푸시로 해소. 폴링/인앱 토스트 알림은 그대로 유지(중복 방지는 tag로).

## 2026-06-22 (iter 26) · Stella Talk '재전송 1' 멈춤 수정 · pass 128/128
- node --check api/chat-room.js OK · talk.html new Function 파싱 OK · npm test 103 + .mjs 25 = 128/128 · 시크릿 0 · sw v69→v70
- 원인: ① 재시도 3회(≈7s) 소진 후 'failed' 고정 → flushFailedQueue가 'online' 이벤트에만 동작(오프라인 전환 없으면 영영 재시도 안 함) → "재전송 1" 영구 잔존. ② iter25 push 훅이 전송 응답 경로에 await로 묶여 있던 것(키 없으면 무해하나 경로 결합) 제거.
- 수정: (서버) push를 VAPID 키 있을 때만 import + fire-and-forget로 분리 → 전송 응답을 절대 지연/차단하지 않음(키 없는 현행 prod는 push 경로 미접촉). (클라) flushFailedQueue throttle(12s)+periodic(12s)+visibility/focus 자동 플러시 → 일시 실패가 스스로 회복돼 '재전송' 사라짐.
요약 3줄:
1. "재전송 1이 안 사라지고 메시지 안 감"의 핵심은 실패 메시지 자동 재발송이 online 이벤트에만 걸려 있던 것 → 주기/포커스/가시성 변경 시에도 자동 재발송하도록 보강.
2. 최근(iter25) 추가한 백그라운드 푸시 훅을 전송 응답에서 완전 분리(키 있을 때만 동작, fire-and-forget) → 전송 경로 결합/지연 제거.
3. clientId 동일 → 서버 dedup으로 자동 재발송해도 중복 메시지 없음. 단위테스트 128/128 유지.

## 2026-06-22 (iter 27) · Stella GPT 사이드바 Stella Clover 바로가기 제거 · pass 103/103
- index.html 바로가기에서 Stella Clover <a>(stella-clover.vercel.app) 1개 제거(HTML only, JS 무변경). new Function 파싱 OK · 전체 103/103 · 시크릿 0 · sw v70→v71.
- 다른 바로가기(GPT/Talk/DB/ABAP/Agent Code/Codex/Cloud/Hub)·관리자 회원승인 유지. Clover 링크는 index.html에만 있었음(타 앱 미존재).
요약 3줄:
1. 요청대로 Stella GPT 사이드바의 Stella Clover 빠른 즐겨찾기만 제거.
2. 시각/레이아웃·visibility 로직(.admin-only) 영향 0, 나머지 8개 바로가기 그대로.
3. HTML 단일 요소 삭제 → 회귀 0(테스트 103/103 유지), sw 캐시 bump로 클라 갱신.

## 2026-06-22 (iter 28) · Stella GPT 다크모드 표/TSV 복사 블록 블렌드 · pass 103/103
- index.html .bubble pre 다크 오버라이드 추가(검은 바탕 #0d1117 + 흰 글씨 #e6edf3 + #30363d 보더). 라이트(#f8fafc) 불변. JS 무변경.
- new Function 파싱 OK · 규칙 존재 확인 · 전체 103/103 · 시크릿 0 · sw v71→v72.
요약 3줄:
1. 원인: .bubble pre(복사용 표/TSV 박스)에 body.dark 오버라이드가 없어 다크모드에서도 흰 박스(#f8fafc)로 튐. 표(table)는 이미 다크 토큰 적용돼 있었음.
2. 수정: body.dark .bubble pre → 검은 바탕·흰 글씨로 주변 UI와 블렌드(요청대로). pre code도 투명 배경+흰 글씨.
3. 복사 버튼(.copy-btn)은 iter24 테마 유지(다크=흰 핀). 라이트 모드/기능/회귀 0.

## 2026-06-22 (iter 29) · Stella GPT 다크 복사블록 블렌드 보강(재요청) · pass 103/103
- iter28의 body.dark .bubble pre 를 .messages pre / .row.ai pre / .codebox 까지 broaden(렌더러·컨테이너 무관 보장) + sw v72→v73(캐시 강제 갱신). 라이트 #f8fafc 불변, JS 무변경.
- new Function OK · 규칙 존재 확인 · 전체 103/103 · 시크릿 0.
요약 3줄:
1. 동일 요청 재접수 → 원인은 배포전/SW캐시 stale 뷰로 추정(iter28 규칙은 정상, 덮어쓰는 규칙·hljs 없음 확인).
2. 보강: marked(.bubble pre)·폴백(pre.codeblock)·.codebox 등 답변영역의 모든 코드/표 박스를 다크에서 검은 바탕·흰 글씨로 강제 → 흰 박스 확실 제거.
3. SW 캐시 bump로 사용자 브라우저가 새 CSS를 받도록 강제(업데이트 버튼/재방문 시 적용).
