# Stella GPT — 회원가입 승인 프로세스 테스트 결과

목표: 무작위 봇 가입 차단. 가입 신청은 누구나 가능하되 **관리자 승인 전에는 로그인 불가**.
승인 권한: `ADMIN_IDS = ["yesblue0342", "admin"]` (소문자 비교, 대소문자 무시).

## 변경 파일 목록

| 파일 | 구분 | 내용 |
|------|------|------|
| `lib/approval.js` | 신규 | 승인 로직 공유 모듈: `isAdmin`, `effectiveStatus`, `canLogin`, `loginDenialMessage`, `isValidTransition` |
| `api/auth.js` | 수정 | 가입 시 `status="pending"` 저장(+`requestedAt`), 로그인 시 **서버측** 승인 판정 → pending/rejected 403 |
| `api/admin-approvals.js` | 신규 | 관리자 전용 승인 API. **모든 호출 서버측 권한검증**(id+password). GET=목록, POST=승인/거절 |
| `index.html` | 수정 | 가입 성공 시 "승인 대기" 안내(자동로그인 차단) + ADMIN_IDS 전용 "가입 승인" 패널/토스트 |
| `sw.js` | 수정 | 서비스워커 캐시 `stella-v31` → `stella-v32` |
| `test/approval.test.js` | 신규 | 승인 로직 단위테스트 |

## 데이터 모델 (Phase 1)

- 저장소: **Google Drive** `auth/users/{idKey}.json` (Azure SQL은 부가 인덱스, 실패 무시) — Phase 0 실제 코드 확인 결과.
- 추가 필드: `status` ("pending" | "approved" | "rejected"), `requestedAt`, `approvedAt`, `approvedBy`.
- **하위호환**: `status` 필드가 없는 기존 user는 `approved`로 간주 (기존 실사용자 잠김 방지). ✅ 테스트 통과
- ADMIN_IDS는 DB 상태와 무관하게 항상 approved 취급. ✅ 테스트 통과

## 테스트 결과 — 단위/로직 (오프라인, node 실행)

`node test/approval.test.js` → **29 PASS / 0 FAIL**

| 항목 | 결과 |
|------|------|
| `isAdmin` 대소문자 무시 (yesblue0342 / YESBLUE0342 / Admin / 공백) | PASS |
| 비관리자(`normaluser`)/빈값/null → not admin | PASS |
| 하위호환: status 없는 user → approved (로그인 통과) | PASS |
| status "" / null → approved | PASS |
| status 전이: pending → 로그인 차단 | PASS |
| status 전이: approved → 로그인 통과 | PASS |
| status 전이: rejected → 로그인 차단 | PASS |
| pending 메시지 "관리자 승인 대기 중입니다." | PASS |
| rejected 메시지 "가입이 거절되었습니다." | PASS |
| 관리자 + status pending/rejected → 강제 approved | PASS |
| 상태 전이 대상 검증: approved/rejected 허용, pending/임의값 거부 | PASS |
| 비관리자 승인 호출 차단 게이트 (`isAdmin(caller)===false`) | PASS |

## 정적 검증 (node --check / new Function)

| 파일 | 검증 | 결과 |
|------|------|------|
| `lib/approval.js` | `node --check` | OK |
| `api/auth.js` | `node --check` | OK |
| `api/admin-approvals.js` | `node --check` | OK |
| `index.html` (인라인 스크립트 4개) | `new Function(code)` | OK (0 errors) |

## 보안 설계 (Phase 4 — 서버측 권한 검증)

- `api/admin-approvals.js`는 **모든** 요청에서 호출자가 `ADMIN_IDS`인지 + 비밀번호가 맞는지 서버측 검증(`authenticateAdmin`).
  기존 인증 방식(Drive 레코드 `password_hash` pbkdf2 검증 / `admin`+`admin` 하드코딩) 재사용.
- 클라이언트 단 체크만으로 통과 불가 → 봇이 엔드포인트를 직접 호출해도 인증 실패(401/403).
- 승인/거절 상태 전이는 `isValidTransition`으로 approved/rejected만 허용.

## 엔드포인트 스모크 테스트 (배포 후) — 〔배포 시 갱신〕

> 아래 항목은 Vercel 배포 후 실제 엔드포인트로 검증한다. (배포에는 GitHub 쓰기 토큰 필요)

| 항목 | 기대 | 결과 |
|------|------|------|
| 신규 가입(`POST /api/signup`) → `pending` | 201, `pending:true`, "승인 대기" 메시지 | 〔대기〕 |
| pending 계정 로그인(`POST /api/login`) | 403, "관리자 승인 대기 중입니다." | 〔대기〕 |
| 비관리자 승인 호출(`POST /api/admin-approvals`) | 401/403 거부 | 〔대기〕 |
| 관리자 승인 호출 → approved 전환 | 200, status=approved | 〔대기〕 |
| approved 계정 로그인 | 200, 로그인 성공 | 〔대기〕 |

## 배포 커밋 해시 — 〔배포 시 갱신〕

`deploy.ps1` 실행 후 각 파일 커밋 해시 기록. (최종 커밋 해시: _배포 후 기입_)
