# Stella 산출물 저장소: Azure SQL → Google Drive (StellaGPT/0download)

요청: "Stella Hub Azure DB 위의 작업을 구글 드라이브 StellaGPT/0download 폴더로".
→ 저장 백엔드를 **Azure SQL 신설 대신 기존 Google Drive 인프라 재사용**(StellaGPT/0download). 새 키·라우트·Azure 스키마 없음.

## 완료 (코드, main 푸시)
- `lib/drive-files.mjs` — `saveAgentFilesToDrive({files,title,source})`
  - 기존 `lib/drive-utils.js`의 `getDrive()`(OAuth refresh token) + `ensurePath()` 재사용.
  - 경로: **StellaGPT/0download/<YYYYMMDD(KST)>/<title>/<상대경로>** — 하위폴더 보존, 바이너리-safe(base64 지원), traversal 차단.
  - 폴더 링크(webViewLink) 반환.
- `api/cc/save-drive.js` — 세션 산출물 수집(본문/이벤트) → Drive 저장, Drive 폴더 링크 반환. (이전 `save-github.js` 대체)
- `cc.html` — 저장 버튼이 `/api/cc/save-drive` 호출, 라벨 "💾 Drive에 저장", 성공 시 폴더 열기 링크.
- 결과: **에이전트 생성 산출물이 공개 GitHub가 아니라 비공개 Google Drive(StellaGPT/0download)에 저장** → 공개 노출 해소.

## 사용법
- 엔드포인트: `POST /api/cc/save-drive` body `{ session }` (또는 `{ session, files:[{path,content,encoding?}] }`).
- 응답: `{ ok, storage:'google-drive', folder, folderId, folderLink, saved, total, files:[{path,name,link}] }`.
- 필요 env(이미 설정됨): `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`(=StellaGPT 루트).

## 가정 로그
1. **Azure 미사용**: "중복 회피" 원칙 + 기존 Drive가 이 앱의 primary 저장소이므로 ST_FILES(Azure) 신설 대신 Drive 재사용이 합리적. (요청도 Drive로 명시)
2. `StellaGPT/0download`: `getDriveRootId()`가 StellaGPT 루트를 가리키므로 `ensurePath(['0download', ...])` = StellaGPT/0download.
3. `save-github.js`는 호출처를 제거(cc.html이 save-drive로 전환)했으나 파일 자체는 잔존(직접 POST 시에만 동작). 에이전트 경로에선 더 이상 사용 안 함.

## 남은 작업 / 한계 (정직)
- **작업 4 이전(ZAQMR0080)**: 공개 `stella-ai-workspace/0program/ZAQMR0080/`(9파일)을 Drive로 옮기고 공개본 삭제 →
  Drive 업로드는 **런타임 Google 자격증명**이 필요해 **샌드박스에서 실행 불가**(Azure/0Program 때와 동일 제약).
  안전을 위해 **공개 0program 폴더는 삭제하지 않음**(Drive 사본 확인 전 삭제 시 데이터 손실). 배포본에서 마이그레이션 엔드포인트로 1회 실행 후 검증→삭제 권장.
  ※ 공개 레포 git history 잔존 → 완전 제거엔 history rewrite/레포 비공개화 필요.
- **작업 5 Hub에서 Drive 0download 탐색**: 기존 Drive 탐색 인프라(`api/drive-list`·`drive-tree`·`drive-manage`, Stella GPT/DB)가 이미 Drive를 브라우징함. Hub에 "Drive 소스" 탭을 붙이는 것은 후속(별도 요청 시).
- **작업 6 Excel 폴백**: `api/gh-export-excel.js`(기 구현)가 GitHub 대상. Drive 대상 Excel 폴백은 후속.
- 배포 보호(403)로 라이브 검증 불가 → `node --check`·인라인 JS 파싱·로직 정적 검증으로 대체.

## 검증
- `node --check`: lib/drive-files.mjs, api/cc/save-drive.js 통과.
- cc.html 인라인 모듈 스크립트 `node --check`(임시 .mjs) 통과.
- 시크릿 스캔(diff) 0. SW 캐시 bump.
