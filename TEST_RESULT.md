# Stella GPT — 콜드 스타트/동기화/승인 프로세스 수정 테스트 결과

작성일: 2026-06-20
대상 커밋 브랜치: main
실행 환경: 로컬(node), node_modules 미설치 → 외부 모듈(mssql/jsdom) 비의존 검증 위주

## 1. 작업 범위

### 작업 1 — Azure SQL 콜드 스타트 + PC/휴대폰 동기화
- 앱 로드 시 `SELECT 1` warm-up ping 선제 호출
- 타임아웃/5xx 시 3회 자동 재시도 (지수 백오프)
- 로컬 캐시(localStorage)와 서버 데이터를 **타임스탬프 기반 LWW**로 머지

> 참고: 현재 Stella GPT(index.html)의 로컬 캐시는 IndexedDB가 아니라 **localStorage** 입니다.
> 요청 의도(로컬 캐시 ↔ 서버 타임스탬프 머지)를 실제 사용 중인 localStorage 캐시 기준으로 구현했습니다.

### 작업 2 — 회원가입 승인 프로세스 점검 및 완성
- 승인 요청 알림(관리자), 승인/거절 UI·API, 승인 후 사용자 알림
- 미승인 사용자 로그인 안내 메시지
- pending/approved/rejected 상태 DB 저장
- 누락/미완성 보완

## 2. 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `lib/retry.js` (신규) | 의존성 없는 순수 재시도 유틸 `withRetry` (지수 백오프) |
| `lib/db.js` | `withRetry` 재노출, `getPool()` 연결 3회 재시도, `warmup()`(SELECT 1) 추가 |
| `api/warmup.js` (신규) | warm-up 엔드포인트 — `warmup()` 호출, 항상 200 |
| `api/workspace.js` | GET 읽기 쿼리 `withRetry`(3회) 래핑 |
| `api/hybrid-chat-list.js` | 연결+읽기 쿼리 `withRetry`(3회) 래핑 |
| `index.html` | `fetchWithRetry`(AbortController 타임아웃+재시도), `warmupDb()` 앱 로드 핑, sync-engine.js 로드, `syncFromServer` LWW 머지, room/project `updatedAt` 스탬프, 승인 후 알림 토스트, 관리자 대기건수 배지 |
| `api/auth.js` | 로그인 응답에 `status`/`approvedAt` 노출, Azure 인덱스에 `status` 컬럼 저장, `updateAzureStatus()` 추가 |
| `api/admin-approvals.js` | 승인/거절 시 Azure `status` 갱신(best-effort) |
| `lib/approval.js` | `approvalNotice()` 순수 함수 추가(승인 1회 알림 판정) |
| `lib/sync-engine.js` | index.html에서 클라이언트 로드(기존 엔진 재사용) |

## 3. 테스트 결과

### 3.1 단위 테스트 (`node --test test/*.test.js`)
```
ℹ tests 62
ℹ pass 62
ℹ fail 0
```
- `test/retry.test.js` (신규): 5건 — 즉시성공/2회실패후성공/전부실패throw/onRetry횟수/retries=1 → 전부 PASS
- `test/sync-engine.test.js`: 기존 13건 + 크로스-디바이스 LWW 2건(PC↔휴대폰 양방향 최신본 채택) → 전부 PASS
- `test/approval.test.js`(자체 harness): 36 PASS / 0 FAIL — 기존 29건 + `approvalNotice` 7건(approvedAt 기준 1회 알림/중복방지/pending·rejected 무알림/하위호환 무알림) → 전부 PASS
- 기타 기존 테스트(room-membership, upload-route 등) 회귀 없음

### 3.2 구문 검증 (`node --check`)
```
OK  lib/retry.js
OK  lib/db.js
OK  lib/approval.js
OK  api/warmup.js
OK  api/workspace.js
OK  api/hybrid-chat-list.js
OK  api/auth.js
OK  api/admin-approvals.js
```

### 3.3 index.html 인라인 스크립트 파싱
```
Inline scripts checked: 4, errors: 0
```
(`new Function(code)`로 4개 인라인 스크립트 전부 구문 오류 없음)

## 4. 승인 프로세스 점검 결과 (체크리스트)

| # | 항목 | 상태 | 근거 |
|---|---|---|---|
| 1 | 가입 신청 시 관리자 승인 요청 알림 | ✅ 완성 | 관리자 FAB에 **대기 건수 빨간 배지** 추가(`setBadge`/`refreshBadge`), `admin-approvals` pending 목록이 알림 큐 역할 |
| 2 | 관리자 승인/거절 UI·API | ✅ 동작 | `index.html` 승인 패널(FAB→모달, 승인/거절 버튼) + `api/admin-approvals.js`(서버측 관리자 인증 게이트) |
| 3 | 승인 후 사용자 알림(앱 내) | ✅ 완성 | 로그인 응답에 `status`/`approvedAt` 노출 → 클라이언트가 `approvedAt` 기준 **1회 환영 토스트** 표시 |
| 4 | 미승인 로그인 안내 메시지 | ✅ 동작 | `loginDenialMessage`(pending: "관리자 승인 대기 중", rejected: "가입이 거절되었습니다") → 403 + `#authMsg` 표시 |
| 5 | pending/approved/rejected DB 저장 | ✅ 동작/보강 | Drive `auth/users/{id}.json`의 `status`가 SSOT, 가입 시 pending 저장·승인 시 갱신. Azure 인덱스에도 `status` 컬럼 추가·동기화(best-effort) |
| 6 | 누락/미완성 보완 | ✅ | 위 1·3·5 보완 완료 |

## 5. 콜드 스타트/동기화 검증 요약

- **warm-up**: 앱 로드(`DOMContentLoaded`)와 복원 시작(`restoreAllData`) 시 `/api/warmup`(SELECT 1, 3회 재시도) 선제 호출 → 목록 로딩 전에 서버리스 풀 예열.
- **재시도**: 채팅목록(`/api/hybrid-chat-list`)·노트(`/api/note`)·워크스페이스(`/api/workspace`) 모두 `fetchWithRetry`(12s 타임아웃 + 3회 백오프). 서버측도 `getPool` 연결 3회 + 읽기 쿼리 3회 재시도.
- **타임스탬프 머지(LWW)**: `StellaSync.mergeById`로 rooms/posts/projects를 id 기준 병합, `updatedAt` 최신본 채택. 채팅은 메시지 추가/이름변경/이동 시 `updatedAt` 스탬프, `syncToServer`가 `updatedAt` 전송. 단위테스트로 PC↔휴대폰 양방향 최신본 수렴 확인.

## 6. 코드 리뷰 (2-lane: architect + code-reviewer)

- **architect (Opus, 데이터 무결성/인증 집중)**: **APPROVED**. 인증 우회 없음, 미동기화 로컬 데이터 손실 없음, "don't shrink" 가드 유지, 멱등 LWW 병합 확인. 후속 권고만 제시.
- **code-reviewer**: 1 HIGH(채팅방 삭제 tombstone 미전파) + 일부 MEDIUM/LOW.

### 리뷰 후 적용한 수정
- `fetchWithRetry`: 마지막 시도 뒤 불필요한 백오프 대기 제거(최대 2s 지연 단축).
- `admin-approvals.setStatus`: `approvedAt`을 **승인 시에만** 기록(거절은 기존값 유지), `rejectedAt`/`statusAt` 분리 기록.
- `refreshBadge`: 인증 만료(401/403) 시 배지 0으로 숨김.
- `admin/admin` 로그인 응답에 `status`/`approvedAt` 포함(응답 형태 일관성).

### 의도적으로 보류한 항목 (정직한 보고)
- **채팅방 삭제의 크로스-디바이스 전파(tombstone)**: 채팅방은 서버측 soft-delete 경로가 없어 한 기기에서 삭제해도 다른 기기에서 되살아날 수 있음. **이는 이번 변경 이전부터 존재하던 한계**이며, 이번 LWW 변경이 이를 악화시키지 않음(로컬 단독 항목은 보존, 편집은 최신본 채택으로 개선).
  - 완전한 해결은 데이터 손실 방지의 핵심인 `_serverSnapshot`("로컬이 서버보다 적으면 저장 차단") 가드를 완화해야 하므로, **무인 자동 배포 직전에 핵심 안전장치를 성급히 변경하는 위험**을 피하기 위해 후속 작업으로 분리함. (노트 삭제는 `/api/note` Drive soft-delete로 정상 전파됨.)

## 7. 한계/주의

- 실제 Azure SQL 연결·Drive 호출이 필요한 경로는 로컬에 `node_modules`가 없어 **라이브 통합 테스트 미수행**(Vercel 배포 환경에서 동작). 로직은 순수 함수 단위테스트 + 구문검증으로 커버.
- 관리자 대기 건수 배지는 보안상 관리자 인증 캐시(`__adminCred`)가 있을 때만 갱신됨(비밀번호를 영구 저장하지 않음). 최초 로그인 후 승인 패널을 한 번 열어 인증하면 이후 배지가 표시됨.
- 이메일 발송 인프라는 미구성이라 사용자 요청의 허용 범위("이메일 또는 앱 내 알림")에 따라 **앱 내 알림**으로 구현.
