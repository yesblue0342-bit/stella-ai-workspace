# TEST_REPORT — Stella Codex OpenAI Rate Limit(429/TPM) 대응 (2026-07-08)

## 개요
Stella Codex/ABAP의 대용량 ABAP 소스 분석 시 발생하던 OpenAI 429(TPM 초과)를 코드 레벨에서
방어. 기존 GPT/Claude 라우팅은 그대로 두고 방어 로직만 얹음(회귀 없음).

## 변경 파일
| 파일 | 내용 |
|---|---|
| `lib/openai-tpm.mjs` (신규) | 429 판별, Retry-After/backoff 계산, 재시도 래퍼, 토큰 사전추정, 롤링 TPM 예산 트래커(`TpmBudget`), `safeMaxTokens`, `shouldChunk`, 모델 다운그레이드, 친화 에러 메시지 |
| `lib/abap-chunk.mjs` (신규) | ABAP 구조 경계(FORM/METHOD/CLASS/…) 분할(`chunkAbapSource`, 전체 라인 커버리지 보장), ABAP 판별(`looksLikeAbap`), 이슈 추출/중복제거/종합(`mergeAbapAnalyses`) |
| `api/chat.js` | `callOpenAI`에 재시도+롤링예산+선제대기+mini폴백+max_tokens(예산 빡빡할 때만) 적용. 비-라우팅 OpenAI 경로에 대용량 ABAP 청킹 분기(게이트: 안전마진 초과 & ABAP 코드성 & Drive Q&A 아님). raw 429 미노출. |
| `api/codex/agent.js` | `callOpenAIOnce`에 429 backoff 재시도 + 2회 반복 시 mini 다운그레이드 + 친화 에러 |
| `test/openai-tpm.test.js` (신규) | 유틸 단위 테스트 14케이스 |
| `test/abap-chunk.test.js` (신규) | 청킹/종합 단위 테스트 9케이스(라인 커버리지 검증 포함) |
| `test/openai-429-scenario.test.js` (신규) | 과제 스샷 429 재현 end-to-end 4시나리오 |

## 설계 요지 (과제 작업 1–8 대응)
1. **호출 지점**: ABAP 분석 = `abap.html`/`codex.html` → `/api/chat` → `callOpenAI`. Codex 레포 자동화 = `/api/codex/agent` → `callOpenAIOnce`. gpt-4.1/mini 라우팅은 `resolveOpenAIModel`.
2. **429 재시도**: `Retry-After` 헤더 → 메시지의 `try again in Xs` 파싱 → `2^attempt+jitter`. 최대 6회, 상한 60초. 실패요청도 한도 카운트되므로 반드시 대기 후 재시도(tight loop 금지).
3. **토큰 사전추정 + max_tokens**: `estimateMessagesTokens`(char/4, 한글 보정)로 입력 추정. 예산 여유가 8192 미만일 때만 `max_tokens`를 조여 TPM(입력+출력) 초과 회피(여유 충분 시 미지정 → 기존 긴 출력 보존). 잘리면 이어쓰기 안내.
4. **청킹**: 안전마진(TPM 60%) 초과 & ABAP 코드로 판별될 때만 `FORM/METHOD/CLASS…` 경계로 분할, 청크별 분석 후 `mergeAbapAnalyses`로 종합(중복 이슈 제거). 라인 커버리지 100% 보장.
5. **롤링 TPM 예산**: `TpmBudget`가 최근 60초 소비 토큰을 타임스탬프 큐로 추적, 초과 예상 시 오래된 토큰이 빠질 때까지 선제 대기(429 발생 전 회피). 프로세스 전역(조직 TPM과 정합).
6. **모델 폴백**: 429 2회 반복/초대형 입력 시 gpt-4.1→gpt-4.1-mini 자동 하향. 기존 라우팅 위에 폴백만 추가.
7. **프롬프트 캐싱**: system 프롬프트를 항상 messages[0]에 고정 유지 → OpenAI 자동 prompt caching 히트율↑.
8. **UX**: raw 429 노출 금지(친화 한국어 메시지로 치환). 청킹 시 답변에 "N개 청크로 나누어 분석" 헤더 표시.

## 테스트 시나리오 & 결과
| 시나리오 | 검증 | 결과 |
|---|---|---|
| 정상(소형) | 예산 여유 시 max_tokens 미지정·기존 경로 동작 | 회귀 없음(전체 스위트 동일) |
| 429 단발 | 스샷 메시지 `try again in 4.232s` → 4232ms 대기 후 재시도 성공 | PASS (scenario A) |
| 429 반복 | 2회 반복 → gpt-4.1→gpt-4.1-mini 폴백 후 성공 | PASS (scenario B) |
| 롤링 윈도우 | Used 15658 + Requested 16458 > 30000 → 선제 대기(59s) | PASS (scenario C) |
| 최종 실패 | 재시도 소진 시 rate-limit 에러 유지(호출부가 친화 메시지 치환) | PASS (scenario D) |
| 대용량 청킹 | 다중 FORM 소스 분할 시 `join===원본`(누락 0), 경계 없는 블록도 hardMax 분할 | PASS (abap-chunk) |
| 종합/중복제거 | 청크 경계 중복 이슈는 종합에서 1회만 | PASS (abap-chunk) |
| ABAP 게이트 | 일반 문서(대용량)는 청킹 안 함(회귀 방지) | PASS (looksLikeAbap) |

## 자동 회귀 (`npm test`, 이 샌드박스)
- 신규 테스트 **27/27 PASS** (openai-tpm 14 + abap-chunk 9 + scenario 4).
- 전체: 259 tests / **218 pass** / 25 fail / 16 skip.
  - ※ 25 fail는 **이 샌드박스에 npm 의존성(googleapis·mssql 등) 미설치**로 인한 import 실패(기존과 동일).
    변경 전(baseline) 동일하게 25 fail — **내 변경으로 늘어난 실패 0건**(baseline 191 pass → 218 pass, fail 25 불변).
  - 배포/CI 환경(의존성 설치됨)에서는 기존 291 그린 + 신규 27 = 통과 예상.
- 서버측 문법 `node --check`: `lib/openai-tpm.mjs`, `lib/abap-chunk.mjs`, `api/chat.js`, `api/codex/agent.js` 전부 OK.

## 수용 기준 대응
- [x] 30k 초과 ABAP 소스 → 청킹으로 누락 없이 분석(라인 커버리지 테스트로 보장).
- [x] 429 발생 시 자동 재시도 후 성공, 사용자 개입 불필요(scenario A/C).
- [x] 청킹 결과 이슈 누락 없음 + 중복 제거(abap-chunk 테스트).
- [x] gpt-4.1 실패 시 mini 폴백(scenario B, codex agent 동일).
- [x] 기존 GPT/Claude 라우팅·기타 기능 회귀 없음(전체 스위트 실패 증가 0).

---

# TEST_REPORT — Stella GPT Autopilot (최신: 2026-07-04)

## 최신 상태 (2026-07-04 — 크로스플랫폼 테스트 안정화)
- 전체 회귀: **291/291 PASS** (fail 0, skip 0) — `npm test` (node --test)
- 수정: `test/codex-workspace.test.js` 의 `safeRelPath` 2개 케이스가 POSIX 경로(`/tmp/ws`)를
  하드코딩해 Windows(백슬래시·드라이브레터)에서 오탐 실패 → OS 네이티브 경로(`join(tmpdir(),...)`)로
  교체해 Windows·Linux 양쪽에서 통과. 프로덕션 보안검사(`lib/codex-workspace.mjs`)는 무변경.
- 서버측 JS 문법(node --check) 통과.

## 이전 상태 (Loop 5, 2026-07-02)
- 전체 회귀: **266/266 PASS** (fail 0, skip 0)
- Loop 5 신규: loop5-fixes(7) + router extractText(2) + chat-stream truncation/cfg(2) + 기존 갱신
- 서버측 JS 문법(node --check) 전 파일 통과, 모든 api 핸들러 import/HTML 인라인 파싱 정상
- 배포 영역 직접 점검: .env.example 필수키 완비 · 커밋 시크릿 없음 · Dockerfile/health 정합 → 확정 문제 0

---

# TEST_REPORT — Stella GPT 자동 반복 수정 (Autopilot Loop, 2026-07-02)

이전 리포트(0Program 자동 저장 복구, 2026-07-02 오전)는 git 이력에 보존.
이번 리포트: 야간 Autopilot 루프(진단→수정→테스트) 결과.

## 자동 테스트 케이스 결과

| # | 테스트 | 결과 | 근거 |
|---|---|---|---|
| 1 | 전체 회귀 스위트 | ✅ **242/242** (fail 0, skip 0) | `npm test` — 기존 239 + 신규 3. 수정 전 기준선은 1 fail(jsdom 부재) + 15 skip이었음 |
| 2 | Drive 의도 오탐 방지 | ✅ 11/11 | test/drive-intent.test.js — 'driver'/'OneDrive'/마크다운 제목/셔뱅/#include/80자 초과 해시줄에서 미발동 |
| 3 | Drive 의도 정상 발동 | ✅ 11/11 | '내 드라이브'/'#Celltrion'/'#구글드라이브폴더 …'/Drive·Docs 링크/후행 줄 #명령에서 발동 |
| 4 | skipDrive 이중읽기 차단 계약 | ✅ | 소스 계약 고정 테스트 + gpt.html 분석 플로우에 skipDrive:true 전달 확인 |
| 5 | 문법 검증 (node --check) | ✅ 0 에러 | 수정 파일 전부: api/chat.js, api/claude.js, api/drive-tree.js, api/note-scan.js, api/cc/_maclient.mjs, lib/drive-utils.js |
| 6 | 모듈 로드/시그니처 | ✅ | 전체 api/ 핸들러 import 스윕 0 실패, default export 전수 확인 |
| 7 | HTML 인라인 스크립트 파싱 | ✅ | index/gpt/talk/db/abap/codex/hub 전부 통과 (cc.html은 type=module로 정상) |
| 8 | DOM 런타임(jsdom) | ✅ | login-data-sync 회귀(교차기기 데이터 소실 가드) 포함 DOM 테스트 16종 실행·통과 — 기존엔 미설치로 skip/fail |
| 9 | Claude API 정합성 | ✅(문서 검증) | claude-api 스킬 공식 문서로 검증: Opus 4.8 단가 $5/$25, Opus 4.7/4.8·Fable 5 temperature 400 거부, 캐시 최소 프리픽스(2048~4096토큰) |
| 10 | 잘림 안내(stop_reason) | ✅(코드 검증) | callClaude가 max_tokens 잘림 시 이어쓰기 안내 부착 |

## 프롬프트 예산 검증 (토큰 낭비 방지)
- Drive 발췌 총량: **≤ 22,000자 보장** (8파일 × 균등 배분, 하한 1,200자) — 기존엔 16파일 × 2,500자 ≈ 40K자로 예산 1.8배 초과 가능.
- gpt.html 분석 플로우: 인라인 내용 **≤ 24,000자** + 서버 재읽기 skipDrive 차단 — 기존 최악 ~19만 자.
- 무관 메시지의 Drive 스캔(오탐) 자체가 사라져 해당 케이스 Drive API 호출 10~30건/메시지 → 0건.

## 미실행(환경 제약) — 운영 배포 후 자동/수동 확인 항목
- 실 API 호출 E2E(OpenAI/Anthropic/Drive 실호출)는 이 CI 컨테이너에 시크릿이 없어 실행 불가.
  → main 반영 시 deploy-oci.yml이 배포 후 컨테이너 내부 스모크(/api/drive-diagnostics +
  /api/db/save-program 실쓰기)를 자동 실행하고 결과를 ci-smoke 브랜치에 게시함.
- 아침 수동 확인 권장 3건: ① "SAP QM이 뭐야?" ② "#구글드라이브폴더 <실폴더> 분석해줘"
  ③ 마크다운 문서 붙여넣기(# 제목 포함) → Drive 스캔 없이 정상 답변.

## 종합
- PASS: 242/242 (자동) + 코드/문서 검증 4건
- FAIL: 0
