# Stella GPT 워크스페이스 — 검색·IME·권한 스코프 (작업 기록)

브랜치: `claude/stella-gpt-workspace-search-x0rjn1`

## 요청 4건과 처리

### 1) 사이드바 검색(🔍): 채팅·노트·프로젝트 통합 + 이동(스크롤+하이라이트)
- `index.html`의 `doSideSearch()`에 **프로젝트 검색 섹션(📁) 신규 추가**.
  - 프로젝트는 **카테고리명** + **소속 채팅의 제목/메시지 내용**까지 매칭("프로젝트 전체" 검색).
- 노트(제목+내용), 채팅(제목+메시지 내용)은 기존 유지 + 채팅은 **매칭 메시지 스니펫** 표시.
- 결과 클릭 시 이동 + **하이라이트(노란 깜빡임 `.search-flash`)**:
  - 채팅 → 방 열고 **매칭 메시지로 스크롤 + 하이라이트**.
  - 노트 → 노트 목록 열고 해당 노트(`data-note-id`)로 스크롤 + 하이라이트.
  - 프로젝트 → 사이드바에서 펼쳐 보이고(`exp` 확장) 해당 프로젝트(`data-proj`)로 스크롤 + 하이라이트.

### 2) 한글 IME 검색 버그(조합 중간값 '민상ㅇㅓㄴ'으로 검색됨)
- 원인: `js/sidebar-search.js`의 **document 위임 `input`/Enter 핸들러에 조합 가드가 없어**, 인라인 `oncompositionend` 수정(이전 커밋)을 우회해 조합 중 부분 자모로 검색이 실행됨.
- 수정: `window.__sideComposing` 플래그를 **인라인 핸들러와 위임 핸들러가 공유**.
  - `compositionstart` → true, `compositionend` → false 후 **확정값으로 1회만** 검색.
  - `doSideSearchLive`는 조합 중이면 즉시 return. Enter는 `isComposing`/`keyCode===229`면 무시.
  - 노트 검색창(`#noteSearch`)도 `window.__noteComposing`으로 동일 처리(인라인 + DOMContentLoaded 리스너 양쪽).

### 3) 채팅·노트를 본인(user_id) 것만 — 서버측 권한 스코프
- 문제: 모든 데이터 엔드포인트가 **클라이언트가 보낸 `userId`/`owner`를 그대로 신뢰** → 타인 id를 보내면 타인 데이터 접근 가능(IDOR). 서버측 인증이 전무했음.
- 해결: **무상태 HMAC 서명 세션 토큰** 도입(`lib/session.js`).
  - 로그인/가입 성공 시 서버가 토큰 발급 → 응답 `token` + **httpOnly 쿠키 `stella_session`**(`api/auth.js`, `api/member-store.js`).
  - 데이터 엔드포인트는 `requireOwner(req,res,요청id)`로 **토큰의 uid로만 스코프**. 미인증=401, 타인 요청=403, 관리자=대상 허용.
  - 적용: `workspace.js`(채팅/프로젝트/노트 동기화), `note.js`, `hybrid-chat-list/save.js`, `chat/history.js`, `memory.js`, `profile/*`. `chat.js`는 코어 챗 비차단을 위해 **소프트 스코프**(토큰 있으면 그 uid로 메모리 스코프, 없으면 기존값 폴백).
  - 프론트(`index.html`): 토큰 저장 + 데이터 호출에 `Authorization: Bearer` 첨부 + 401 시 1회 재로그인 안내.
- **전달 경로 2중화**: 동일출처 호출은 httpOnly 쿠키로 자동 인증되므로, **헤더를 추가하지 않은 다른 앱(abap/gpt/restore)도 재로그인 후 그대로 동작**.

### 4) DB(PostgreSQL 기준, azure-sql-edge 폐기) / 배포 규약
- ⚠️ **현 코드베이스·`CLAUDE.md`·`.env.example`는 전부 MSSQL(`mssql`, OCI `stella-mssql`) 기준**입니다(요청문의 "PostgreSQL 기준"과 불일치).
  엔진 전면 이관은 본 작업(검색/IME/권한) 범위를 크게 벗어나고 체크인된 `CLAUDE.md`(권위 문서)와 충돌하여 **수행하지 않았습니다.**
- 대신 **이번 변경은 DB에 전혀 의존하지 않도록 설계**(`lib/session.js`는 순수 crypto HMAC). 따라서 메타DB가 MSSQL이든 PostgreSQL이든 **그대로 동작**합니다.
  → PostgreSQL 이관을 원하시면 별도 작업으로 진행 권장(영향 범위: `lib/db.js`, `lib/memory-db.mjs`, `lib/cc-db.mjs`, 다수 `api/*`의 T-SQL, `db/04_schema.sql`, deploy 스크립트).
- 배포: 변경은 지정 브랜치에 push. 운영 반영은 `main` 병합 시 `.github/workflows/deploy-oci.yml`이 OCI 서버로 자동 재배포(SW 캐시 `v91→v92`로 프론트 갱신 보장).

## 배포 후 주의(전환 1회)
- 서버측 스코프가 켜지므로 **기존 세션(토큰/쿠키 없음)은 다음 동기화 시 401** → 안내 후 **재로그인 1회**면 정상화(로컬 데이터는 보존, 손실 없음).
- 운영 환경에 **`SESSION_SECRET`(또는 `PROXY_SECRET`/`ADMIN_PASSWORD`) 설정 필수**(공개 레포이므로 고정 폴백 사용 금지). `.env.example` 참고.

## 테스트 결과
- `node --test test/*.test.js` → **180 tests, 175 pass, 0 fail, 5 skipped**(skip은 jsdom 미설치 게이트).
- jsdom 설치 후 DOM 테스트 포함 → **19/19 pass**(IME 조합 회귀 테스트 포함, 실제 `sidebar-search.js` 구동).
- `lib/session.js` 단위 테스트(`test/session.test.js`): 서명/검증/위조·만료 거부/키 격리/`requireOwner`(401·403·admin·soft)/쿠키 경로 등 통과.
- `index.html` 인라인 스크립트 4블록 **구문 정상**(`new Function`), 변경 API 12개 `node --check` 정상.
- jsdom 통합: `doSideSearch` 프로젝트/노트/채팅 섹션·필터·프로젝트 클릭 내비게이션 **12/12 pass**.
