# 로그인 데이터 동기화 — 원인분석 · 조치 · 테스트 결과

**증상 (반복 신고):** 아이디/비밀번호가 동일한데도 **새로운 환경(새 브라우저·기기)에서 로그인하면**
노트/채팅/프로젝트 폴더/메모 수/채팅 수가 **읽혀오지 않음.** 한 곳(공용 DB)을 바라보므로 동일해야 함.

---

## 1. 원인분석 (Root Cause)

핵심 원인은 **"신규 환경의 초기 서버 읽기 실패 → 빈 상태로 서버 데이터 덮어쓰기(파괴)"** 였다.

동기화 경로 (`index.html`):
1. 로그인 → `showApp()` → `restoreAllData()`
2. `syncFromServer()` 가 `GET /api/workspace` 에서 `workspace_state`(채팅·프로젝트·노트 전체 JSON)를 읽어 병합
3. 데이터가 없으면 기본 `새 채팅` 생성 → `_restoreCompleted=true`
4. `syncToServer()` 가 현재 상태를 `POST /api/workspace` 로 저장 (MERGE = **전체 덮어쓰기**)

**버그 시나리오 (신규 환경):**
- SQL 콜드스타트/타임아웃/일시 네트워크 오류로 2단계 **읽기가 실패** → 로컬은 빈 상태
- 유일한 보호장치는 `meaningfulRooms.length < _serverSnapshot.rooms` 였는데, 읽기 실패 시
  `_serverSnapshot` 이 기본값 `{0,0,0}` 그대로라 **가드가 무력화**
- 결과: 빈(또는 `새 채팅` 1개뿐인) 상태를 `POST` → 서버 `workspace_state` 를
  **빈 배열로 덮어써 계정 전체 데이터가 소실**
- 이후 **모든 새 환경**이 빈 백엔드를 읽어 "안 보임" → 자기강화형 데이터 손실

> 부수 결함: `loadChatHistoryFromDrive()` 만 `Authorization: Bearer` 헤더를 보내지 않아
> 쿠키 차단 환경(사파리 ITP/시크릿/교차출처)에서 채팅 인덱스 복원이 401 로 실패.
> 동일 파괴 패턴이 `abap.html`(같은 `workspace_state` 공유)에도 존재.

---

## 2. 조치 (Remediation) — 방어 심층화(defense in depth)

| # | 파일 | 조치 |
|---|------|------|
| 1 | `index.html` | `_serverPullOk` 플래그 추가. **서버 상태를 1회 이상 성공적으로 읽기 전에는 `syncToServer` 저장 자체를 차단.** (읽기 성공 후 로컬은 서버의 상위집합이라 저장 안전) |
| 2 | `index.html` | `loadChatHistoryFromDrive` 에 `authHeaders()`/`authNudge()` 적용 — 쿠키 없는 환경에서도 채팅 복원 |
| 3 | `abap.html` | 동일 `_serverPullOk` 가드 적용 (같은 백엔드 공유, 부분 덮어쓰기까지 차단) |
| 4 | `api/workspace.js` + `lib/workspace-guard.js` | **서버측 2차 방어:** 채팅·프로젝트·노트가 모두 빈 저장 요청이 기존 비어있지 않은 행을 덮어쓰지 못하게 차단(`force=1`/`allowEmpty` 시 예외). 부분 삭제는 정상 동기화 |

**치유(curative) 효과:** 배포 후, 로컬에 데이터가 살아있는 주 기기가 앱을 열면
읽기 성공(빈 서버) → 로컬 유지 → `_serverPullOk=true` → 로컬을 **다시 서버로 push** 하여
백엔드가 자동 복구된다. 이후 새 환경들은 복구된 백엔드를 정상적으로 읽는다.

---

## 3. 테스트 결과 (Test Results)

실행: `node --test test/*.test.js` (jsdom 로 **실제 `index.html` 인라인 함수**를 그대로 구동)

```
# tests 202
# pass  202
# fail  0
```

신규 회귀 테스트 (기존 193 + 신규 9):

**`test/login-data-sync.test.js` — 실제 코드 구동(jsdom):**
- ✅ 읽기 실패(신규 환경) → `workspace POST` **0건** (백엔드 파괴 차단)
- ✅ 읽기 성공+서버 빈 상태 + 로컬 데이터(주 기기) → 로컬을 **재push(자가치유)**, body 에 방/노트 포함 확인
- ✅ 읽기 성공+서버 데이터 → 빈 새 환경에 채팅/노트/프로젝트 **정상 복원**

**`test/workspace-guard.test.js` — 서버 가드 순수 로직:**
- ✅ 빈 판정(`[]`,`null`,`{}` 등) 정확
- ✅ 기존 데이터 존재 시 전체-빈 덮어쓰기 차단 (노트만 있어도 차단)
- ✅ 신규 사용자(기존 없음)의 정상 빈 저장은 허용
- ✅ 부분 저장(삭제 동기화)은 허용 / `force` 플래그는 가드 우회

**정적 검증:** `node --check api/workspace.js` OK · `index.html`/`abap.html` 인라인 스크립트
`new Function()` 파싱 OK.

---

## 4. 범위/안전성
- 하드코딩·화이트리스트·토큰(uid) 규칙은 변경 없음 → 소유자 키 일관성 유지
- 정상 저장 핫패스에 추가 쿼리 없음(전체-빈 요청일 때만 1회 SELECT)
- 되돌림 안전: 순수 함수 + 플래그 기반, 기존 동작 보존
