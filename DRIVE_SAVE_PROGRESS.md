STATUS: DONE

# DRIVE_SAVE_PROGRESS — 산출물 Drive(0Program) 자동 저장 복구

## 진단 결과 (§2 — 코드/실드라이브 증거 기반, 추측 아님)
| 의심 원인 | 판정 | 증거 |
|---|---|---|
| 경로 불일치(0download) | **부분 사실(과거)** | BASE_FOLDER는 2026-06-23 커밋 `e616aa8`에서 이미 0Program으로 통일. UI/주석 잔재만 0download |
| OCI 라우트 누락 | **아님** | server.mjs는 api/ 전체 동적 마운트, save-drive 정상 라우팅(BLOCKED_API에 없음) |
| Drive OAuth 만료 | **아님** | OAuth 자체는 정상(읽기 생존). ※7/1~2 쓰기는 별개 앱(stellaclover) 소행으로 판명 |
| **env 값 오염(URL)** | **★★최종 진범** | Drive 실사: 이 레포 서버의 ensurePath 쓰기(chatgpt/chats 등)가 **6/26에서 중단** = Vercel→OCI 전환 시점. OCI `.env`의 루트 변수에 폴더 **URL 전체**가 저장됨(진단: length 72, prefix https://dr) → 'File not found: .' → `getDriveRootId()` throw → 모든 서버측 Drive 쓰기(채팅백업·노트·0Program) 조용히 실패. 읽기는 폴더ID 직접 지정 경로라 생존 |
| 규칙 미구현 | **사실** | CLAUDE.md에 저장 규칙/Autopilot 블록 부재 → 추가함 |

### 진짜 근본 원인 (3가지)
0. **[치명] GOOGLE_DRIVE_FOLDER_ID 이관 누락** — 6/26 이후 서버측 Drive 쓰기 전면 마비(위 표).
   → 수정: `getDriveRootIdSafe()` 신설 — env 없으면 'StellaGPT' 폴더 자동 탐색/생성·캐시.
   ensurePath 및 전 쓰기 경로가 이를 사용 → **.env 수정 없이도 채팅백업/노트/0Program 쓰기 전부 부활**.
   `.env.example`에 변수 문서화(재발 방지).
1. **Stella GPT(index.html) — 주력 앱에 저장 연결 자체가 없었음.** cc/codex/abap만 자동저장.
2. **소스 가드(코드펜스 ``` 필수)** — 테스트 대본·스펙 등 산문형 산출물은 가드에 걸려 저장 스킵.
   → 0Program 빈 폴더 + 사용자가 0download에 수동 업로드로 우회(오늘 "Unit Test BB" 등).

## 구현 (§3)
- 공용 모듈 `lib/drive-files.mjs`: `programFileName()`(YYYYMMDD_HHmm_<앱>_<제목>.<확장자>, KST)
  + `saveProgramToDrive()`(fixedName 업서트 지원). 기존 인증 재사용(401→refresh 자동).
- `POST /api/db/save-program` 신설({app,title,ext,content}, dryRun 지원, 항상 JSON).
- **Stella GPT 자동저장 연결**: source-guard 로드 + 답변 후 가드 통과 시 `/api/cc/save-drive`
  자동 호출(성공 토스트 "💾 0Program 저장: <파일명>"). cc/codex/abap와 동일 파이프라인.
- CLI `scripts/save-to-drive.mjs`: 직접 Drive API(레포 .env 간이 로더) → 실패 시 로컬 서버 API 폴백.
- 0download 표기 잔재 전부 0Program으로 통일(cc/codex/save-drive 주석·버튼 문구).
- CLAUDE.md: "산출물 저장 규칙" + "Autopilot 계약" 블록 추가.
- `.claude/settings.json`: bypassPermissions 기존 반영 확인(변경 불요).
- **배포 후 스모크**(deploy-oci.yml): 매 배포마다 `_deploy_smoke.txt`를 0Program에 업서트
  (파일 1개만 유지) → 서버→Drive 쓰기 파이프라인을 배포마다 실검증, 로그에 결과 출력.

## 결정 기록 (Autopilot 가정)
- **PR 미생성**: 레포 CLAUDE.md 절대 규칙("절대 새 브랜치나 PR 만들지 마라, main 직접 커밋")이
  프롬프트 말미 문구보다 우선 — main 직접 push로 배포(기존 세션 관행과 동일).
- CI 컨테이너에는 GOOGLE_* env가 없어 실업로드 검증은 배포 스모크 + Drive MCP 실사로 대체.
- 자동저장 게이트는 소스 가드 유지(모든 채팅이 파일화되는 노이즈 방지). 산문형 산출물은
  다운로드 버튼(Word/PDF) 또는 CLI/save-program 명시 호출로 저장.

## 테스트: TEST_REPORT.md 참조 (전체 238/238)
