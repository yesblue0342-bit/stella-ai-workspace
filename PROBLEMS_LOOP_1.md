# Loop 1 — 발견된 문제 (2026-07-02, 자동 진단)

진단 방식: 5개 영역(시스템 프롬프트 / Function Calling / Drive 효율 / 에러 처리 / 배포) 병렬 진단
→ 발견별 적대적 검증(반박 시도) 통과분만 확정. 총 19건 발견, 7건 확정, 1건 반박 기각,
나머지는 세션 한도로 검증 에이전트 중단 → 메인 세션에서 코드 직독으로 직접 검증.

## 🔴 심각도 높음 (확정)
1. **[api/chat.js:487] needsDrive 과잉 발동** — 영어 'drive' 부분 문자열(driver/driven/OneDrive)과
   "아무 줄이나 #로 시작"(마크다운 제목·코드 주석·#include)에도 Drive 전체 스캔이 돌아
   최대 28K자의 무관한 파일 내용이 프롬프트에 주입되고, 답변이 "정확한 폴더명으로 다시 시도"
   안내로 하이재킹되며, web_search까지 비활성화됨.
2. **[gpt.html:427] '#구글드라이브폴더 X 분석해줘' 이중 읽기 + 무제한 프롬프트** —
   클라이언트가 폴더를 읽어(파일당 8,000자 × 최대 20개 = 최대 16만 자) message에 넣은 뒤,
   서버가 같은 메시지로 needsDrive를 재발동해 같은 폴더를 다시 읽음(추가 12파일 + 28K자).
   message는 어디서도 잘리지 않아 최악 ~19만 자(모델 컨텍스트 초과 하드 에러 / 429).
3. **[lib/drive-utils.js:550] 크기/형식 가드 없는 전체 다운로드** — mp4/png/zip 등 추출 불가
   형식과 초대형 파일도 통째로 RAM에 다운로드(응답은 빈 문자열). 동영상 폴더 분석 시
   컨테이너 OOM 위험 + 대역폭 낭비. 50MB CSV도 전부 받은 뒤 3만 자만 사용.

## 🟡 심각도 중간 (확정)
4. **[lib/drive-utils.js:818] 파일당 2,500자 하한이 22,000자 총예산을 무력화** — 9개 이상 읽으면
   총량 30~40K자로 팽창(429 재발 방향). chat.js의 28,000자 블라인드 슬라이스가 닫는 태그와
   출처표기 규칙을 잘라먹음.
5. **[api/drive-tree.js:30] /api/drive-tree 100% 500** — getDriveRootIdSafe 미임포트 ReferenceError.
6. **[api/note-scan.js] 읽기 전용 진단이 Drive에 빈 폴더 ~13개 생성** — ensurePath 기반
   list/read가 조회 경로를 전부 '생성'. 호출당 Drive API ~50-80건.
7. **[lib/drive-utils.js:695] 경로 세그먼트당 200개 전체 목록 조회** — 이름 질의 대신 목록 스캔.
   자식 200개 초과 폴더에서는 실존 경로도 "찾지 못함" → 드라이브 전체 키워드 폴백으로 오폭.

## 🟡 심각도 중간 (메인 세션 직접 검증으로 확정)
8. **[api/chat.js:675] searchDriveContext 반환 타입 버그** — searchDrive()의 {folder,files} 객체를
   배열로 취급(results.length) → SAP 키워드 Drive 컨텍스트가 항상 무음 실패. *(Loop 1 중간 커밋에서 선수정)*
9. **[api/chat.js:966] callClaude 선두 assistant 히스토리** — 잘린 히스토리가 assistant로 시작하면
   Anthropic 400 ("first message must use the user role").
10. **[api/chat.js:968] max_tokens 4096 잘림 무표시** — stop_reason 미확인으로 잘린 답변을
    완결된 것처럼 반환 (앱은 "전체 내용을 지금 작성하라"고 지시하는데).
11. **[api/cc/_maclient.mjs:156] Opus 4.8 단가 3배 과다($15/$75, 실제 $5/$25)** — 예산 가드가
    설정 예산의 1/3 지점에서 Agent Code 세션을 조기 강제 중단. *(claude-api 스킬 문서로 단가 검증)*
12. **[api/cc/_maclient.mjs:111] listEvents 페이지네이션 없음** — 이벤트 1,000건 초과 장기 세션에서
    이후 이벤트가 영영 안 보여 UI 정지.
13. **[api/claude.js:70] Opus/Fable에 temperature 무조건 전송** — Opus 4.7/4.8·Fable 5는
    temperature를 400으로 거부 → 해당 모델 요청 전부 실패. 'fable' 모델명은 Sonnet으로 무음 다운그레이드.
    *(참고: /api/claude는 server.mjs BLOCKED_API로 외부 차단된 엔드포인트 — 위험도 낮음이나 수정)*
14. **[테스트 인프라] jsdom 미설치** — login-data-sync 테스트 상시 실패(1 fail) + DOM 테스트 15개 스킵.
    *(Loop 1 중간 커밋에서 선수정 — devDependency 추가로 239/239 복구)*

## 🟢 심각도 낮음 / 의도적 보류 (수정 안 함, 사유 기록)
- **[api/chat.js:961] Anthropic cache_control 미사용** — 현 시스템 프롬프트는 ~800토큰으로
  캐시 최소 프리픽스(Fable 5/Sonnet 4.6 = 2,048, Opus 4.8 = 4,096토큰) 미달이라 마커를 붙여도
  캐시가 생성되지 않음. 대신 "정적 프롬프트 먼저, 메모리 뒤" 재배치만 적용(프리픽스 안정화).
- **[api/chat.js:417] STELLA_SYSTEM_PROMPT의 KH 프로필 하드코딩** — 개인 프로젝트(단일 사용자
  중심) 설계 의도로 판단, 보류.
- **[api/chat.js:925] 비라우팅 OpenAI 경로 '[표+요약]' 강제 프리픽스** — Stella GPT의 표 우선
  UX 설계 의도(bare 플래그로 opt-out 존재), 보류.
- **[api/chat.js:561] 라우팅 경로에서 body.system 미사용** — 라우팅 프롬프트 체계의 설계로 판단, 보류.
- **[api/drive-utils.js] 구버전 중복 Drive 헬퍼** — 검증 결과 **반박 기각**: 이를 쓰는
  member-chat-save/drive-test 엔드포인트는 server.mjs BLOCKED_API로 이미 404 차단 → 실행 경로 없음.

총 확정 문제: 14건 (수정 완료 14건 / 보류 5건)
