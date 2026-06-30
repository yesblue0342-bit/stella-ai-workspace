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

## 배포 (1차)
- `sw.js` 캐시 `stella-v95 → stella-v96`(프론트 변경분 강제 갱신).
- main 푸시 시 GitHub Actions `deploy-oci.yml` → OCI 재빌드/재실행.
- ※ 새 API 키/라우트 없음(기존 인프라 재사용), 시크릿 노출 없음, 모든 핸들러 에러 시에도 JSON 반환 유지.

---

# 2차 — UI 톤다운 (차분하게, 다른 파일앱처럼)

> 요청: "요소들이 너무 쨍하다 → 구글 드라이브 모바일처럼 차분·은은하게. 단, 다크/라이트 모두."
> 대상: `db.html`(+`sw.js`). **main 직접 배포.**

## 변경
1. **폴더 아이콘**: 쨍한 노란 📁 이모지 → **무채색 인라인 SVG**(`fill=currentColor`, `.file-icon{color:var(--icon)}`). 파일 이모지는 `filter:saturate(.5)`로 채도↓. 폴더선택 피커도 동일.
2. **테마 토글**: ☀️/🌙 이모지 → **가는 라인 SVG**(해/달) `setThemeIcon()`, 버튼색 `var(--text2)`(회색).
3. **경로복사**: 📋 제거 → 텍스트만. **헤더 🗄** → 무채색 막대 SVG. **`＋ 폴더`**(📁 제거).
4. **체크박스**: 1차의 흑백 고대비(투박한 검정 네모) → **얇은 1.5px 테두리·은은한 회색**, 선택 시에만 차분한 회색 채움. (`--chk-border/--chk-fill/--chk-mark` 토큰)
5. **전체 톤**: `--primary` `#1f6feb→#3b6db5`(채도↓), `--danger` 약화, `.btn/.act` `saturate(.6~.7)`로 글리프 채도↓. 다크=진회색 배경·부드러운 흰 텍스트, 라이트=밝은 회색·중간 회색 아이콘.

## 어드버서리얼 리뷰(7 에이전트) → 반영
"차분"이 "안 보임"이 되지 않도록 대비 검증. 확정 5건 중 실행 3건(나머지 2건은 "현행 양호, 변경 불가" 결론):
| 심각도 | 내용 | 조치 |
|--------|------|------|
| medium | 라이트 미선택 체크박스 테두리 1.58:1(거의 안 보임) | `--chk-border` `#c4c8cd→#808890`(3.38:1) |
| medium | 라이트 선택 체크박스 채움/체크 2.4~2.6:1(모호) | `--chk-fill` `#9aa0a6→#6b7280`(채움 4.39:1, 체크 4.83:1) |
| low | 다크 미선택 테두리 2.28:1 | `--chk-border` `#484f58→#6e7681`(4.12:1) |
| nit | 다크 체크 3.89:1 | 통과 — 제안된 수정은 도형 대비 역행이라 미적용(현행 유지) |
| nit | 폴더SVG·토글·danger·primary | 4.4~6.2:1, 양호 — 조치 없음 |

## 검증 (모두 PASS)
- WCAG 대비 재계산(흑백 톤 유지하면서 3:1 충족):
  - 다크 미선택 테두리 4.12/3.77/3.31 · 선택 채움 3.31 · 체크 3.89
  - 라이트 미선택 테두리 3.38/3.59/3.27 · 선택 채움 4.39 · 체크 4.83
- 정적 검증 9종 PASS(인라인 JS `new Function`, 핸들러 28·요소 35 정합, 폴더/토글 SVG 헬퍼·`iconHTML` 배선, 고대비 토큰 제거 확인, 🗄/☀️/📋/📁＋ 이모지 제거, `#1f6feb` 완전 치환).
- jsdom 런타임 **21건 PASS**(다운로드/압축 기능 무회귀 + 폴더/토글 SVG 렌더 + 헤더/토글 이모지 부재).
- 전체 스위트 **187/187 PASS**(회귀 0).

## 배포 (2차)
- `sw.js` 캐시 `stella-v96 → stella-v97`.
- **main 브랜치 직접 push** → GitHub Actions `deploy-oci.yml` → OCI 자동 재빌드/재실행.
- ※ 1차(다운로드/압축) + 2차(톤다운)가 함께 main 으로 배포됨. 새 키/라우트 없음, 시크릿 노출 없음.

---

# 3차 — 업로드 "Failed to fetch" 오탐 수정

> 증상: 파일은 정상 업로드됐는데 "업로드 중… ❌ <파일명>: Failed to fetch" 오류가 뜸.
> 요청: 진짜 오류면 고치고, 정상 동작이면 "업로드 완료"처럼 긍정 메시지로.

## 원인 (진단)
- resumable 세션은 **서버에서** 개시(브라우저 Origin 없음) → 브라우저가 청크를 **크로스오리진으로 Drive에 직접 PUT**.
- 바이트는 Google에 도달(파일 생성됨)하지만, 서버 개시 세션의 응답에는 CORS 헤더가 없어 **브라우저 fetch가 응답을 못 읽고 `TypeError: Failed to fetch`** 발생.
- 기존 재시도(`queryResumeOffset`)도 **브라우저 PUT** → 같은 CORS 벽 → 삼켜짐 → 3회 모두 실패 → 실제 성공인데 실패로 표시. = **오탐**.

## 수정
- **서버 신규 액션 `upload-status`**(`api/drive-manage.js`): 서버가 세션에 `Content-Range: bytes */<total>` PUT(서버↔Google은 CORS 무관) → 200/201=완료(fileId/name 반환), 308=미완(수신 바이트), 404/410=세션 소멸. **SSRF 가드**(`https://*.googleapis.com/`만 허용) + `redirect:"manual"`(리다이렉트 우회 차단).
- **`db.html`**: `verifyUploadStatus()`(위 서버 액션 호출) + `friendlyUploadErr()`(날 "Failed to fetch" → 안내문 변환). `uploadResumable()`는 청크 PUT 실패 시 **서버에 실제 완료 여부 확인** → 완료면 `{ok:true}`(→ "✅ 완료"), 수신 바이트만큼 이어받기, 최종 확인까지 실패면 친절한 메시지. CORS로 무용한 `queryResumeOffset` 제거.

## 판정 로직
- **정상 업로드(증상의 경우)**: 브라우저는 "Failed to fetch"여도 → 서버 검증 200/201 → **"업로드 완료"**. (오탐 제거)
- **진짜 실패**: 서버 검증이 308(미완)·404(소멸)·오류 → 명확한 안내 메시지. (오탐 아님 — 실제 오류만 표시)

## 어드버서리얼 리뷰(6 에이전트, logic·server·regression) → 결과
- 회귀 리뷰 **0건**. 확정 2건 모두 **nit**:
  - SSRF 가드가 첫 홉만 검사(리다이렉트 미검사) → **`redirect:"manual"` 추가로 하드닝**(반영).
  - 서버가 308+received==total 보고 시 성공 처리(Google 프로토콜상 도달 불가, 또한 "바이트가 이미 Google에 있으니 성공"이 사용자 의도와 일치) → 변경 불필요.

## 검증 (모두 PASS)
- `node --check` · drive-manage import OK.
- **신규 서버 단위 테스트 `test/upload-status.test.js` 6건 PASS**: SSRF 거부, uploadUrl 누락 400, 200→complete, 308→incomplete(Range 파싱), 404→gone, JSON 파싱 실패 시도 ok.
- **jsdom 업로드 시나리오 11건 PASS**: (A) "Failed to fetch"지만 서버 검증 완료 → `ok:true`(완료), (B) 진짜 실패 → 친절 메시지(날 "Failed to fetch" 미노출), 헬퍼 정의·죽은 함수 제거 확인.
- 정적 9종 · jsdom 회귀 21건 · **전체 스위트 193/193 PASS**(신규 6건 포함, 회귀 0).

## 배포 (3차)
- `sw.js` 캐시 `stella-v97 → stella-v98`.
- **main 직접 push** → `deploy-oci.yml` 자동 배포. 새 키 없음, 신규 라우트는 기존 `drive-manage` 액션 추가뿐, 시크릿 노출 없음(상태 조회는 Authorization 미전송 — upload_id 로 식별).
