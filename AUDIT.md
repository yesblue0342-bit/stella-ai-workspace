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
