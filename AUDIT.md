# 전수 검사 AUDIT (iter 12, autopilot)

## A1 회귀 추적 — 인증 전원 장애 (관리자+회원 동시)
- **증상**: 회원 로그인 "가입 정보가 없습니다"(401) + 관리자 인증 실패가 동시 발생.
- **근본원인(회귀 아님 + 회귀 둘 다)**:
  - 공용 Drive 조회 경로 `readUser → readJsonFromDrive → ensurePath → getDriveRootId/getDrive(OAuth)`가 실패하면(예: GOOGLE_DRIVE_FOLDER_ID 미설정으로 `getDriveRootId`의 `mustEnvAny` throw, 또는 refresh token 만료/폐기로 1시간 후 401) 회원·관리자 양쪽이 동시에 깨짐 — "공용 모듈 하나가 깨졌다"는 진단과 일치.
  - 진짜 회귀(코드): `readUser`의 `catch{}`가 **저장소 오류를 'not-found'로 둔갑**시켜 401 "가입 정보 없음"으로 표기 → 실제 원인(Drive 토큰/FOLDER_ID)이 보이지 않아 데이터 소실/로그인 버그로 오인하게 만듦.
- **수정(타겟, 재설계 아님)**:
  - `api/auth.js readUser`: 파일 없음=null, **조회 실패=throw**로 구분. 로그인 핸들러는 Drive throw→Azure 폴백→그래도 없으면 `driveErr`면 **503 AUTH_STORE_UNAVAILABLE**(명확), 아니면 401.
  - `api/admin-approvals.js`: 동일하게 readUser 오류를 503로 surface(관리자 인증 실패 오인 방지). admin/admin·ADMIN_PASSWORD(env) 경로는 Drive 없이 통과.
  - (이전 iter11 A1) ADMIN_PASSWORD env 관리자 경로 + Azure SQL password_hash 영속/폴백/백필로 Drive 장애에도 로그인 복구.
- **검증**: 실제 핸들러 호출 테스트 — 저장소 장애 시 503(구 401 둔갑) / admin·admin·ADMIN_PASSWORD 200 (Drive 불필요). 84/84.
- **회원 데이터**: 조회·표기만 수정, 저장/삭제 로직 무변경 — 데이터 무손상.
- `[!]` 인프라(에이전트 적용 불가, Vercel 대시보드): 셋 중 하나 — `GOOGLE_DRIVE_FOLDER_ID` 설정 확인 / `GOOGLE_REFRESH_TOKEN` 재발급(만료·폐기 시) / `ADMIN_PASSWORD` 설정(Drive 없이 관리자 로그인). 코드는 정상이며 이 값들이 갖춰지면 즉시 통과.

## P1 구문·정적 검사 — 발견 0 / 수정 0
- api/lib 전 `.js/.mjs` `node --check` 통과(0 fail). HTML 12개 인라인 스크립트 19개 new Function/module 파싱 bad=0. 깨진/중복 함수·끊어진 구문 없음.

## P2 시크릿 스캔 — 발견 0 / 수정 0
- sk-/sk-ant-/ghp_/github_pat_/AIza/xox*/PRIVATE KEY 패턴 소스 0건. 모든 자격증명은 process.env.* 참조(키 이름 일치). 하드코딩 비번 리터럴은 테스트 픽스처/node_modules뿐(실 시크릿 아님). admin/admin은 문서화된 폴백.

## P3 공용 인프라 — 발견 0 / 수정 0 (env 외)
- Drive OAuth: getDrive()가 호출마다 OAuth2 클라이언트 재생성 + setCredentials(refresh_token) → googleapis가 access token 자동 리프레시(1시간 401 자동 처리, 스테일 토큰 캐시 없음). refresh token 자체 폐기만 인프라 이슈(A1 [!]).
- Azure SQL: connectionTimeout/requestTimeout 60000 + getPool withRetry(지수백오프) + warmup(SELECT 1). 타임아웃/콜드스타트 가드 정상.
- 서비스워커: 단일 sw.js, 단일 CACHE 상수(일관). HTML network-first라 캐시 bump로 사용자 스트랜딩/데이터 소실 없음(localStorage는 SW 캐시와 무관).

## P4 앱별 스모크 — 발견 0 / 수정 0
- HTML 12앱이 호출하는 /api 엔드포인트 전수 존재 확인(71개 라우트, 끊어진 호출 0). Stella GPT 로그인+관리자 인증은 실핸들러 테스트로 통과 검증(A1).

## P5 전체 테스트 — 84/84 PASS

## 요약: 발견 1건 / 수정 1건 / 보류 1건(인프라 env)
- 발견·수정: A1 회귀 — Drive 저장소 오류를 "가입 정보 없음"으로 둔갑시키던 readUser catch{} 마스킹 → not-found(401)/저장소오류(503) 구분 + env-admin·Azure 폴백으로 로그인 복구.
- 보류[!]: Vercel env(GOOGLE_DRIVE_FOLDER_ID / GOOGLE_REFRESH_TOKEN 재발급 / ADMIN_PASSWORD) — 대시보드 작업이라 에이전트 적용 불가. 코드는 정상이며 값 갖춰지면 즉시 통과.
