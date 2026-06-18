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
