# Stella DB UI 개선 — 테스트 결과

> 브랜치: `claude/stella-db-ui-improvements-g2nyie`
> 대상: `db.html`(Stella DB 파일 관리 화면), `api/drive-manage.js`, `lib/zipbuild.js`, `sw.js`
> 요청 3건 + 어드버서리얼 리뷰 반영 5건. **물어보지 않고 자동 진행 → 검증 → 배포.**

## 요청 사항 ↔ 구현

### 1. 체크박스·컨트롤 색상을 테마별 흑백 고대비로 (파란 accent 제거)
- `db.html`에 테마 토큰 추가: 다크 `--chk-bg:#000;--chk-line:#fff`, 라이트 `--chk-bg:#fff;--chk-line:#111827`.
- `.file-chk`를 `appearance:none` 커스텀 박스로 교체 — 빈 상태에도 테두리가 또렷이 보이고, 체크 시 같은 색 ✓.
  - 다크: **검은 바탕 + 흰 선/체크**, 라이트: **흰 바탕 + 검은 선/체크**. (기존 파란 `accent-color` 제거)
- `.btn` 텍스트 `--text3 → --text`(가독성↑), `.enter-folder` hover 파랑 → `--text`, `.clip-bar` 하드코딩 파랑(#1e3a5f/#93c5fd) → 테마 토큰.
- (리뷰 반영) 드래그&드롭 강조도 파랑 제거 → 흑백(스크림 + 흰 점선/흰 글자, `--chk-line` 아웃라인).

### 2. 업로드 근처 다운로드 아이콘 + 선택 항목 일괄 다운로드
- 툴바 `업로드` 옆 `⬇ 다운로드` 버튼(`#dlBtn`) 추가 + 선택 바(selBar)에도 `⬇ 다운로드` 추가.
- `downloadSelected()`: **단일 파일 → 즉시 다운로드**, **여러 개·폴더 포함 → 서버에서 ZIP으로 묶어 1개 파일로 다운로드**(브라우저 다중 다운로드 차단 회피).
- 미선택 클릭 시 alert 대신 상태바 안내(비파괴적).

### 3. 압축하기 / 압축풀기 아이콘 및 기능
- 압축풀기(기존): `.zip` 행의 `🗜️ 풀기` 버튼 + 컨텍스트 메뉴 `압축 풀기` 유지.
- **압축하기(신규)**: selBar `🗜️ 압축` + 컨텍스트 메뉴 `🗜️ 압축하기`(단일) → `ctxAction('zip')`.
- 서버 `api/drive-manage.js`에 **`action=zip`** 신설(`zipToDrive`):
  - 선택 파일/폴더를 받아 **폴더는 재귀로 모든 하위 파일**을 `폴더명/상대경로`로 수집(pageToken 페이지네이션).
  - fflate 비동기 `zip`(이벤트 루프 비차단) → 현재 폴더에 `.zip` 업로드. 구글 네이티브 문서는 raw 불가 → 제외(경고).
  - 경로 중복은 ` (n)` 접미사로 회피, 기본 파일명 `압축_YYYYMMDD_HHMM.zip`(단일 항목이면 `<이름>.zip`).
- `lib/zipbuild.js` 신설: `sanitizeZipName`/`timestampName`/`dedupeZipPath` 순수 헬퍼(의존성 0, 클라/서버 공용 가능).

## 어드버서리얼 코드리뷰(9 에이전트) → 반영
워크플로 리뷰→검증 결과 6건 중 5건 확정. 모두 반영 완료(블로커/하이 없음):
| # | 심각도 | 내용 | 조치 |
|---|--------|------|------|
| 1 | medium | zip에 용량 상한 없음 → 거대 파일 선택 시 서버 OOM 가능 | `maxBytes 400MB`/`perFileBytes 250MB` 예산 추가(미리 받은 `size` 합산해 다운로드 전 차단) |
| 2 | nit | `downloadFileFromDrive` fileId 미인코딩(download.js와 불일치) | `encodeURIComponent` 적용 |
| 3 | low | 일괄 "다운로드" 시 ZIP이 Drive에 남는데 문구 미고지 | confirm 문구에 "현재 폴더에 저장 후 다운로드" 명시 |
| 4 | low | 루트(`_curId=''`)에서 압축/업로드 dead-end | 루트 폴더 id(`'root'`) 해석해 동작하도록(Drive `parents[]`가 'root' 수용) |
| 5 | nit | 드래그 강조가 아직 파랑 | 흑백 처리(위 1번 항목) |
| — | (기각) | truncated 시 `total` 과소집계 | UI가 `total` 미표시 → 무해, 조치 불필요 |

## 검증 (모두 PASS)

### 정적 검증
- `node --check api/drive-manage.js`, `node --check lib/zipbuild.js` → PASS.
- `import('./api/drive-manage.js')` 런타임 로드 → default handler 함수 확인.
- 인라인 JS `new Function()` 파싱(40,865자) → PASS (CLAUDE.md 규약).
- HTML 핸들러 28개 전부 정의됨 / `getElementById` 타깃 35개 전부 존재 / 체크박스 토큰 다크·라이트 모두 존재 / `ctxAction('zip')` 연결 확인.

### DOM 런타임 (jsdom, 14건 PASS)
신규 함수 정의·요소 존재 + 동작:
- 미선택 다운로드 → 상태바 안내(무예외), 단일 파일 → `downloadFile` 직접 호출.
- 파일+폴더 혼합 → `POST action=zip`, body `{fileIds:[A,DIR], parentId}` 정확, `downloadAfter` → 생성 zip 다운로드.
- 컨텍스트 압축 → `action=zip` 단일 id, 자동 다운로드 안 함.

### 단위 테스트 (`test/zip-build.test.js`, 7건 PASS)
- `sanitizeZipName`(한글/금지문자/공백/빈값/120자 제한), `timestampName` 포맷, `dedupeZipPath` 중복 회피.
- **fflate 압축→해제 라운드트립**: 한글 경로·중복 경로 포함 원본 동일성 검증.

### 전체 스위트
```
npm test → # tests 187 / # pass 187 / # fail 0 / # skipped 0
```
(샌드박스 초기 13건 실패는 의존성 미설치 아티팩트였고 `npm install` 후 전부 통과. 신규 7건 포함 회귀 0.)

## 배포
- `sw.js` 캐시 `stella-v95 → stella-v96`(프론트 변경분 강제 갱신).
- main 푸시 시 GitHub Actions `deploy-oci.yml` → OCI 재빌드/재실행. (작업 푸시 대상: 위 브랜치)
- ※ 새 API 키/라우트 없음(기존 인프라 재사용), 시크릿 노출 없음, 모든 핸들러 에러 시에도 JSON 반환 유지.
