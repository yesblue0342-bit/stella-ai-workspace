STATUS: PARTIAL (코드 완료 / 작업 2·1-3은 0Program 접근 불가로 안전 종료)

# Stella Hub 파일관리자 완성 + 산출물 비공개 라우팅

## 한눈에
| 작업 | 상태 | 비고 |
|------|------|------|
| 1-1 산출물 라우팅 → 0Program | ✅ 코드 완료 | `CC_SAVE_REPO` 기본값 변경 + folderUrl 하드코딩 제거 |
| 1-2 전 코드베이스 audit | ✅ 완료 | 에이전트 산출물 커밋 경로 = `api/cc/save-github.js` **단 1곳**. github.js/chat.js는 앱 자기소스라 제외 |
| 1-3 토큰 쓰기 테스트(0Program) | ⛔ 실행 불가 | 이 세션은 0Program 접근 거부(스코프 밖). 아래 「한계」 |
| 2 기존 노출분 이전 + 공개 삭제 | ⛔ 안전 종료 | 0Program 쓰기 불가 → **공개 `0program/` 삭제 안 함**(파괴적 작업 미실행) |
| 3 Hub 파일관리자(백+프론트) | ✅ 완료 | 업로드/삭제/이동/복사/이름변경/새폴더/다중선택 |
| 4 미리보기/다운로드 버그 수정 | ✅ 완료 | 스트리밍 프록시 + size guard + 정확한 MIME |
| 5 Excel 폴백 | ✅ 완료 | SheetJS xlsx, 실패 시 CSV(BOM) |

## 작업 1 — 산출물 비공개 라우팅 (보안 P0)
- `api/cc/save-github.js`: `CC_SAVE_REPO` 기본값 `yesblue0342-bit/stella-ai-workspace` → **`yesblue0342-bit/0Program`**(env override 유지).
- `lib/gh-commit.mjs`: `OUTPUT_PREFIX` 상수 + `outputFolderUrl()` 신설 → save-github.js의 folderUrl `"stella-agent-output"` 하드코딩 제거, `outputPath`와 prefix 단일화.
- **Audit 결과**: GitHub에 *에이전트 생성 산출물*을 커밋하는 경로는 `api/cc/save-github.js`(→`lib/gh-commit.mjs ghPutFile`) **하나뿐**.
  - `api/github.js`(DEFAULT_REPO), `api/chat.js`의 stella-ai-workspace 참조는 **앱이 자기 소스를 편집/배포**하는 경로 → 산출물 아님 → **그대로 유지**(혼동 금지).
  - `cli/stella-agent.mjs`는 CC API를 호출하는 클라이언트(직접 커밋 안 함) → 서버 `save-github.js` 변경으로 자동 반영.

## 작업 3 — Hub 파일관리자
**백엔드 `api/github.js`** (임의 owner/repo/branch 대상, 토큰 env-only, `assertSafePath`로 `.env`/`.git`/traversal 차단):
- `upload`(바이너리-safe base64 PUT), `mkdir`(`.gitkeep`), `delete`(sha 자동조회), `copy`, `move`/`rename`(copy→delete, 삭제 실패 시 경고 반환=롤백 불가시 둘 다 보존), `batch`(다중 일괄).
**프런트 `hub.html`**:
- 비활성 stub 활성화(⬆업로드/🗑삭제) + 📋복사/📁이동/✏️이름/＋폴더/☑다중/📊Excel 추가. **현재 선택 레포(0Program 포함) 대상**.
- 파괴적 작업 `confirm` 다이얼로그, 성공 후 **트리 재조회**, **토스트** 피드백, 다크/라이트 유지. 다중선택 체크박스→일괄 삭제.

## 작업 4 — 미리보기/다운로드 버그 수정
- **신설 `api/gh-download.js`**: 서버가 토큰으로 `Accept: application/vnd.github.raw`(최대 100MB)로 원본을 받아 **바이트 그대로 스트리밍**. `Content-Type`(확장자 매핑) + `Content-Disposition`(**RFC 5987 한글 파일명**). **대용량 base64를 JSON에 안 실음** → "Failed to fetch"/0바이트 해결. 에러는 항상 JSON.
- 프런트: 다운로드는 항상 이 프록시 URL(공개·비공개 동일, 항상 열림). 미리보기 **size guard(512KB)** — 텍스트/이미지 소형만 인라인, 초과/바이너리는 다운로드·Excel 안내. `fetchT` 타임아웃 + `safeJson` + 명확한 한글 메시지.

## 작업 5 — Excel 폴백
- **신설 `api/gh-export-excel.js`**: SheetJS(`xlsx`, deps에 존재) 사용. 텍스트/코드→줄 시트, CSV/TSV→파싱 시트, JSON→객체배열/평탄화 시트, 바이너리→META + BASE64 시트. xlsx 생성 실패 시 **CSV(BOM) 폴백**(엑셀에서 열림). 런타임 스모크: xlsx 버퍼 생성 OK.
- 프런트: 「📊 Excel」 버튼 → `/api/gh-export-excel`.

## 한계 / 가정 로그 (정직)
1. **0Program 접근 불가(스코프)**: 이 세션의 GitHub 도구는 `stella-clover`·`stella-ai-workspace`·`leehu`로 제한됨. `yesblue0342-bit/0Program` 호출은 **거부**됨(확인: get_file_contents → "Access denied ... not configured"). `add_repo`/`list_repos` 도구도 이 세션엔 없음.
   - 따라서 **작업 1-3(0Program 토큰 쓰기 테스트)·작업 2(파일 이전 + 공개 삭제)는 실행 불가**.
   - 코드(작업 1-1)는 올바르게 0Program을 가리키며, **배포된 Vercel 함수의 `GITHUB_TOKEN`(repo scope)이 0Program에 쓰기 가능**하면 런타임에 정상 저장됨. 토큰 scope/레포 쓰기 권한은 배포 환경에서만 검증 가능.
2. **공개 `stella-ai-workspace/0program/ZAQMR0080/`(9파일) 미삭제**: 비공개 사본을 만들 수 없는 상태에서 공개본을 지우면 **영구 데이터 손실** → 태스크의 "403/404면 파괴적 작업 미실행" 규칙대로 **안전 종료**. 노출은 남아 있음.
3. **공개 레포 git history 잔존(작업 2-3 경고)**: 설령 파일을 옮기고 삭제해도 과거 커밋은 history에 남는다. 완전 제거엔 **history rewrite(git filter-repo) 또는 레포 비공개 전환**이 필요.
4. **다음 단계 제안**(사용자 조치 필요):
   - (a) 이 세션 스코프에 `0Program`을 추가해 주면 → 작업 1-3 테스트 + 작업 2 이전/삭제를 즉시 완료.
   - 또는 (b) 0Program 스코프 세션에서 migration 수행. 그 전까지 공개본은 그대로 두는 게 안전.
5. **배포 검증 한계**: Vercel Deployment Protection(403)으로 외부 URL 직접 검증 불가 → 정적 검증(`node --check`, 인라인 `new Function`) + 런타임 스모크(xlsx 생성)로 대체.

## Test Report
| # | 테스트 | 결과 |
|---|--------|------|
| 1 | `node --check` (save-github, gh-commit, github, gh-download, gh-export-excel) | 전부 OK ✅ |
| 2 | hub.html 인라인 JS `new Function` | OK(17,443자) ✅ |
| 3 | 산출물 라우팅 기본값 = 0Program | grep 확인 ✅ |
| 4 | folderUrl 하드코딩 제거 → outputFolderUrl | ✅ |
| 5 | 파일관리자 버튼 8종 + 프록시 2종 wiring | 14/14 ✅ |
| 6 | xlsx 런타임 생성 | 15,914 bytes ✅ |
| 7 | 토큰 노출(diff grep) | 0 ✅ |
| 8 | path traversal/.env 차단(assertSafePath) | 유지·신규 적용 ✅ |
| 9 | 0Program 쓰기/이전 | ⛔ 스코프 밖 — 안전 종료(위 한계 1~2) |
| 10 | SW 캐시 bump | stella-v23 → v24 ✅ |
