# TEST RESULTS — Stella Agent Code (워크스페이스 코딩 에이전트)

실행 시각: 2026-06-18 10:52:04 UTC
환경: node v22.22.2 (의존성 0, `node tests/*.mjs`)

## 1) 단위 테스트 — tests/test_agentcore.mjs (lib/agentcore.mjs)
모델 검증/폴백, AgentRun 누적·역순정렬·중복 seq 제거·tool_result 매칭·종료(idle/error) 감지, 백오프, 트랜스크립트.
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

총 17건: 17 PASS / 0 FAIL
```
종료코드: 0

## 2) 통합 테스트 — tests/test_cc_integration.mjs (실 1회, Haiku + 소액 예산)
```
SKIP: CC_BASE_URL 미설정 — 배포 환경에서 실행하세요.
예) CC_BASE_URL=https://stella-ai-workspace.vercel.app node tests/test_cc_integration.mjs

총 0건 (SKIPPED): 통합 테스트는 배포된 프록시 + 서버측 ANTHROPIC_API_KEY 필요.
```
종료코드: 0

> ⚠️ 통합 테스트는 **배포된 프록시 + 서버측 ANTHROPIC_API_KEY + 실제 과금 호출**이 필요합니다.
> CI/샌드박스에는 키가 없어 SKIP 처리됩니다. 배포 후 아래로 실행하세요:
> `CC_BASE_URL=https://stella-ai-workspace.vercel.app node tests/test_cc_integration.mjs`
> 기대: write 툴 발생 + bash 실행 + status idle 도달 + 피보나치 수열 (목표 1/1, 비용 수 센트).

## 총합
- 단위(agentcore): 총 17건: 17 PASS / 0 FAIL  → **17/17 PASS ✅**
- 통합(cc): 배포 환경 실행 필요 (현재 SKIPPED) — 코드/문법 검증 완료
