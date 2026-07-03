# TEST_REPORT — Stella GPT Autopilot (최신: Loop 5, 2026-07-02)

## 최신 상태
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
