STATUS: DONE

# Stella Hub — CI 점검 + 0program/테마/레이아웃 개선

## §1 우선순위 0 — CI 점검 결과 (초록 확인)
- 워크플로 2개(`patch-index.yml`, `patch-member-chat.yml`)는 모두 **path-filtered 패치 자동화**
  (트리거: 워크플로 파일 또는 `scripts/patch-index.js` 변경 시 / `workflow_dispatch`).
  즉 일반 push-CI가 아니다.
- main의 **최신 워크플로 런 = success** (run id `27457653057`, 2026-06-13). 이후 커밋
  (abap/0program/hub)은 트리거 경로를 건드리지 않아 런이 발생하지 않음 → **현재 CI 빨강 아님**.
- 결론: 새 CI 실패 없음. §2 진행 가능. (HTML 임베드 정규식 `\n` 이슈도 이번 변경분엔 없음 — `node --check` 통과.)

## §2-1 0program 읽기 버그 — 원인 & 처리
**원인(진단):** 스크린샷의 빨간 "This repository is empty." 는 Hub 코드 버그가 아니라,
**별도의 비공개 GitHub 레포 `0Program` 이 실제로 비어 있음**(커밋 0개)에서 나온 GitHub 원본 메시지다.
ABAP 프로그램(ZAQMR0080)은 그 레포가 아니라 **`stella-ai-workspace/0program/` 폴더**에 커밋돼 있다
(현재도 Hub에서 `stella-ai-workspace` 레포 → `0program` 폴더로 정상 열람 가능).

**처리(이 세션 권한 범위 내):**
- 서버 `api/github.js readContents`: 빈 레포의 404/409 "empty" 응답을 **에러 대신 빈 디렉터리로 정규화**
  (`{type:'dir', items:[], empty:true, message:'이 레포지토리는 비어 있습니다...'}`). 핸들러는 기존대로 항상 JSON 반환.
- 프런트 `hub.html`:
  - **방어적 JSON 파싱** `safeJson(r)` 추가(`res.text()`→`JSON.parse` try/catch). 평문 응답에도
    "Unexpected token" 대신 한국어 메시지. 적용: 레포목록·디렉터리·파일 미리보기 3곳.
  - **빈 레포 안내**: 빨간 에러 대신 "📭 이 레포지토리는 비어 있습니다 (커밋된 파일 없음)" 친화 문구.
- **한계(정직):** 비어 있는 별도 `0Program` 레포에 파일을 채우는 것은 이 세션의 푸시 권한 범위
  (`stella-clover`/`stella-ai-workspace`/`leehu`) 밖이라 불가. ABAP 원본은 `stella-ai-workspace/0program/`에 그대로 존재.

## §2-2 다크/라이트 모드
- Hub는 이미 토큰화된 테마(`:root` 다크 / `body.light` 라이트, `stella_db_theme` 키) + 🌙 토글 보유.
- **추가:** 저장값이 없을 때 **시스템 설정(`prefers-color-scheme`)** 을 초기 기본값으로 따르도록 `applyTheme` 보강.
  사용자가 바꾼 값은 기존대로 `localStorage`에 저장(PC↔모바일 일관, 같은 출처 공유).

## §2-3 즐겨찾기 정리 + 레이아웃 여유
- 빠른 즐겨찾기 **4개만 유지: GPT / ABAP / DB / Talk**. 나머지(Code, Hub 자기링크) 제거.
- 컨트롤(↻ 새로고침, 🌙 테마)은 유지 — 앱 즐겨찾기가 아니라 기능 버튼.
- 레이아웃 여유: `.top` 패딩 12/18, `.nav` gap 8, 링크/아이콘 **min-height 38px** 큰 터치 타깃,
  radius 10, hover 강조. 좁고 답답하던 헤더 개선(모바일은 여유 있게 줄바꿈).

## §3 워크플로
- `node --check` 통과(api/github.js, sw.js). hub.html 인라인 `new Function` 파싱 OK.
- SW 캐시 **v18→v19** bump + isHTML 네트워크 우선 목록에 `/hub` 추가.
- 작은 커밋: `fix(hub)` / `feat(hub)` / `style(hub)`.

## §4 Test Report
| # | 테스트 | 결과 |
|---|--------|------|
| 1 | CI | 최신 런 success(27457653057), 새 실패 없음 ✅ |
| 2 | `node --check` api/github.js, sw.js | 에러 0 ✅ |
| 3 | hub.html 인라인 스크립트 `new Function`(10,316 chars) | OK ✅ |
| 4 | 0program/빈 레포 | 빨간 에러→친화 안내(📭), 서버 빈 dir 정규화 ✅ |
| 5 | 강제 평문 응답 | `safeJson` 3곳 적용, raw "Unexpected token" 노출 0 ✅ |
| 6 | 다크/라이트 | 토글 동작 + 저장값 유지 + 무저장 시 `prefers-color-scheme` 기본 ✅ |
| 7 | 즐겨찾기 | GPT/ABAP/DB/Talk 4개만, Code·Hub 자기링크 제거(grep 확인) ✅ |
| 8 | 레이아웃 | min-height 38px·gap/padding 확대로 여유 ✅ |
| 9 | 보안 | diff grep, 키·토큰 노출 0 ✅ |

> 런타임 한계: 실제 배포 URL은 Vercel 배포 보호(403)로 외부 확인 불가. 코드/문법/분기 경로는 정적 검증 완료.

## 가정 로그 (질문 대신 결정)
1. CI "빨강" 전제는 stale — 최신 런이 초록이라 §1은 점검·기록으로 충족, 새 워크플로 추가 안 함.
2. "즐겨찾기 4개"는 형식 스펙(§2-3)대로 GPT/ABAP/DB/Talk 유지·Code/Hub 제거로 해석. ↻·🌙는 컨트롤이라 잔류.
3. 0program 콘텐츠는 `stella-ai-workspace/0program/`에 존재하며 Hub에서 해당 레포로 열람 가능 →
   별도 빈 `0Program` 레포는 권한 밖이라 UX(빈 레포 안내)로 혼선만 제거.
4. 테마는 Hub에 확실히 적용(스펙 "최소한 Hub"). 타 앱은 각자 테마 체계 보유 — 회귀 위험 피해 미변경.
5. 푸시 대상 = main(태스크 §0/§5 "main 푸시 → Vercel 자동 배포", 세션 기존 패턴 일치).
