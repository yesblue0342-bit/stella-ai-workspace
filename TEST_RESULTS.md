# TEST RESULTS — Stella Agent Code (코딩 에이전트 + OMC + CLI)

실행 시각: 2026-06-18 12:20:04 UTC
환경: node v22.22.2 (의존성 0, `node tests/*.mjs`)

## 1) 단위 — tests/test_agentcore.mjs (lib/agentcore.mjs)
모델 검증/폴백, AgentRun 누적·정렬·dedupe·tool_result 매칭·종료감지, 백오프, 트랜스크립트, OMC 부트스트랩 프롬프트.
```
PASS  1 isValidModel opus
PASS  2 isValidModel 무효
PASS  3 resolveModel 없는모델 → DEFAULT
PASS  4 resolveModel 유효 → 그대로
PASS  5 역순 이벤트 seq 정렬 누적
PASS  6 cursor = 최대 seq
PASS  7 이미 본 seq 재무시(fresh=0)
PASS  8 새 seq만 반영
PASS  9 초기 상태 running, done=false
PASS  10 tool_use 누적 + result null
PASS  11 tool_result가 같은 이름 미완 tool_use에 매칭
PASS  12 짝 없는 tool_result는 새 항목
PASS  13 status_idle → done
PASS  14 status error → done + 에러 메시지 보존
PASS  15 running 상태는 done=false
PASS  16 nextDelayMs 증가+상한 4000
PASS  17 트랜스크립트: 모델·요청·툴·응답 포함
PASS  18 OMC off: 기본 프롬프트(OMC 미포함)
PASS  19 OMC on: 부트스트랩 지시 + repo 포함

총 19건: 19 PASS / 0 FAIL
```
종료코드: 0

## 2) 단위 — tests/test_cli.mjs (cli/stella-agent.mjs parseArgs)
```
PASS  1 기본 run + 프롬프트 결합
PASS  2 --list
PASS  3 --cancel <id>
PASS  4 --resume <id> + 후속프롬프트
PASS  5 model/budget/omc + 프롬프트
PASS  6 base/bypass/save
PASS  7 --help
PASS  8 --json 플래그

총 8건: 8 PASS / 0 FAIL
```
종료코드: 0

## 3) 통합 — tests/test_cc_integration.mjs (실 1회, 배포 환경 필요)
```
SKIP: CC_BASE_URL 미설정 — 배포 환경에서 실행하세요.
예) CC_BASE_URL=https://stella-ai-workspace.vercel.app node tests/test_cc_integration.mjs

총 0건 (SKIPPED): 통합 테스트는 배포된 프록시 + 서버측 ANTHROPIC_API_KEY 필요.
```
종료코드: 0
> ⚠️ 배포된 프록시 + 서버 ANTHROPIC_API_KEY + 과금 필요(샌드박스 SKIP).
> 배포 보호 켜진 경우 CLI/테스트는 VERCEL_AUTOMATION_BYPASS_SECRET 사용.

## 총합
- agentcore: 총 19건: 19 PASS / 0 FAIL
- cli:       총 8건: 8 PASS / 0 FAIL
- 통합:      배포 환경 실행 필요 (SKIPPED)
- **단위 합계: 27/27 PASS ✅**

---

# Stella Agent Code — 테마 통일 + 세션 산출물 GitHub 저장

`npm test` → **# tests 42  # pass 42  # fail 0** (cc-files 4 + gh-commit 6 신규 포함)

## 작업 A — 다크/라이트 테마 통일 (cc.html ↔ Stella GPT)
- Stella GPT와 **동일 방식**: `body.dark` 클래스 + **`stella_theme` localStorage 키 공유** + 🌙/☀️ 토글(헤더).
- CSS 토큰화: `:root`(라이트) + `body.dark`(다크)에 bg/top/side/card/step/ink/muted/line/accent/input/send/cancel/err/ok/on-accent 정의.
- **하드코딩 색 감사 = 0건**: CSS 규칙(22~61행) 내 `#hex`/`rgb()` 0개(토큰 정의 블록과 per-mode meta theme-color 값 제외).
- `sw.js` 캐시 `stella-v13 → stella-v14` (+1).

## 작업 B — 세션 산출물 GitHub 저장
- `lib/cc-files.mjs` `extractFilesFromEvents`: write/create tool_use에서 {path,content} 복원, 최신 write 우선, traversal 차단. 단위 4/4.
- `lib/gh-commit.mjs`: `outputPath`(stella-agent-output/YYYYMMDD/{title|id}/{path}), `commitMessage`([YYYYMMDD] cc {title} - N files), `ghPutFile`(GET sha→PUT, 신규/업데이트). 단위 6/6 — **토큰이 본문/반환값에 미노출** 검증 포함.
- `api/cc/save-github.js`: 파일 수집(본문 직접 or 이벤트 폴백) → 커밋 → `github_url` 기록. 토큰 미설정 시 명확한 에러, 파일 없으면 빈 커밋 대신 404.
- `lib/cc-db.mjs`: `cc_sessions.github_url` 컬럼 ALTER 추가 + `setSessionGithubUrl`.
- `cc.html`: 세션 완료 시 자동 저장(best-effort) + '💾 GitHub에 저장' 수동 버튼.
- 실제 커밋/Managed Agents 수집은 GITHUB_TOKEN·ANTHROPIC_API_KEY 등 배포 환경 필요 → 배포 후 실세션 검증.

---

# Stella Workspace 확장 — Code 아이콘 + Stella Hub + 업데이트 버튼

`npm test` → **# tests 48  # pass 48  # fail 0** (hub-utils 6 신규) + jsdom 통합 **13/13**.

## 작업 A — Code 탭 아이콘
- index.html 사이드바 바로가기: 🌐 Stella Hub 링크 추가(Code는 기존 🛠 유지).
- cc.html 크로스앱 탭에 아이콘: 🤖 GPT · 💬 Talk · 🗄 DB · 🛠 Code · 🌐 Hub.

## 작업 B — Stella Hub (hub.html, GitHub 브라우저)
- lib/hub-utils.js(순수) 단위 6/6: classify(text/image/binary), rawUrl(+한글), rfc5987, filterFiles, sortContents(폴더 먼저), isRateLimited.
- jsdom 6/6: 공개 레포만 나열(private 제외), 레포→트리(📁/📄), 텍스트 미리보기(raw), 다운로드 버튼, 토큰필요 버튼 비활성+안내.
- 비인증 GitHub API(`/users/:o/repos`, `/repos/:o/:r/contents/:path`), 다크/라이트(Stella DB 토큰·stella_db_theme), 모바일 사이드바 토글, 새로고침/검색.
- vercel.json `/hub`,`/stella-hub` rewrite 추가.

## 작업 C — 업데이트 버튼 (캐시 전체 삭제)
- index.html 사이드바 최하단 '🔄 업데이트' → clearAllCaches(): SW 전부 unregister + caches 전부 삭제 + 강제 reload(localStorage 보존).
- jsdom 3/3: unregister 2건/캐시 삭제 2건/reload 호출.

## 공통
- sw.js 캐시 stella-v14 → v15. node --check: hub-utils.js, sw.js, index 메인 스크립트, hub.html 스크립트 통과.
