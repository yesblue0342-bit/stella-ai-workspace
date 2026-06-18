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
