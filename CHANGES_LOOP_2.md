# Loop 2 — 변경사항 (2026-07-02, 자동 수정)

PROBLEMS_LOOP_1.md의 확정 문제 14건 전부 수정. 파일별 내역:

## api/chat.js
- **detectDriveIntent() 신설(export)** — Drive 트리거를 명시적 의도로 정밀화:
  한국어 '드라이브'/'내 드라이브'(기존 UX 유지), 영어는 단어 경계+수식어(`my|google drive`, `gdrive`),
  Drive/Docs 공유 링크, '#폴더', '#명령' 규약(짧은 `#비공백` 줄만 — `# 제목`/`##`/`#!`/C 전처리·80자 초과 제외).
  → 'driver'/'OneDrive'/마크다운 붙여넣기 오탐으로 인한 무관 Drive 스캔·프롬프트 오염·web_search 차단 해소.
- **body.skipDrive === true 계약 추가** — 클라이언트가 이미 Drive 내용을 읽어 보낸 경우 서버 재읽기 차단.
- **searchDriveContext() 반환 타입 수정** — {folder,files}를 배열로 취급해 항상 무음 실패하던 버그.
- **callClaude(): 선두 assistant 히스토리 제거** — Anthropic 400 방지.
- **callClaude(): stop_reason==='max_tokens' 시 잘림 안내 부착** — 잘린 답변을 완결처럼 반환하지 않음.
- **buildSystemPrompt 호출부: 정적 시스템 프롬프트 먼저, 메모리 뒤로** — 프리픽스 안정화(캐싱 친화).
- Drive truncate 주석 60,000자 → 실값 28,000자로 정정.

## lib/drive-utils.js
- **isExtractableDriveFile() 신설 + 다운로드 전 가드** — 10MB 초과 또는 추출 불가 형식은
  다운로드 자체를 생략하고 read:false + 명확한 한국어 사유 반환 (OOM/대역폭 낭비 차단).
- **프롬프트 발췌 총량 보장** — 발췌 대상을 8개 파일로 제한(초과분은 이름+링크 목록으로),
  파일당 하한 2,500→1,200자. 총량이 22,000자 예산을 넘지 않아 429 재발 경로 차단 +
  chat.js 28,000자 슬라이스에 닫는 태그/출처 규칙이 잘리지 않음.
- **resolveDrivePath: 세그먼트당 정확 이름 질의 우선(findChildByNameExact)** — 요청 1건으로 해석,
  자식 200개 초과 폴더에서도 누락 없음. 실패 시에만 기존 느슨한 목록 매칭 폴백(동작 보존).
- **비생성 조회 헬퍼 신설** — resolvePathIfExists / listJsonIfExists / readJsonById.

## api/note-scan.js
- ensurePath 기반 list/read → 비생성 헬퍼로 전환. 조회만으로 빈 폴더 ~13개가 생성되던
  부작용 제거 + 파일 id 직독으로 호출 수 대폭 감소.

## api/drive-tree.js
- import 수정(getDriveRootId → getDriveRootIdSafe) — 100% 500이던 엔드포인트 복구.

## api/cc/_maclient.mjs
- PRICE['claude-opus-4-8'] $15/$75 → **$5/$25** (claude-api 공식 단가로 검증) — 예산 가드
  조기 중단 해소.
- listEvents(): page/next_page 커서 순회(상한 50페이지) — 1,000건 초과 세션 UI 정지 해소.

## api/claude.js  *(BLOCKED_API로 외부 차단된 엔드포인트지만 정합성 수정)*
- temperature를 지원 모델(sonnet/haiku)에만 포함 — Opus 4.7/4.8·Fable 5 400 거부 해소.
- normalizeClaudeModel에 fable/mythos → claude-fable-5 분기 추가(무음 Sonnet 다운그레이드 해소).

## gpt.html
- Drive 분석 인라인 내용을 **총 24,000자 예산**으로 제한(기존 8,000×20=16만 자) —
  예산 초과 파일은 이름만 목록화.
- /api/chat 호출에 **skipDrive:true** 전달 — 서버 이중 읽기 제거.

## package.json  *(Loop 1 중간 커밋)*
- jsdom devDependency 추가 — 테스트 스위트 복구(프로덕션 이미지는 --omit=dev라 무영향).

## test/drive-intent.test.js (신규)
- detectDriveIntent 양성 11케이스 / 오탐 방지 11케이스 / skipDrive 계약 고정 — 재발 방지.

## 커밋
- Loop 1: `7bfd253` fix(stella-gpt): SAP Drive 검색 무음실패 버그 + jsdom 테스트 복구
- Loop 2: (이 커밋) fix(stella-gpt): Drive 오탐/이중읽기/무가드 다운로드 등 확정 12건 자동 수정
