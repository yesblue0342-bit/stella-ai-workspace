# Stella AI Workspace

## 프로젝트 개요
<!-- 보안: 비밀키/토큰은 코드·문서에 평문 저장 금지. OCI 서버 .env 로만 관리. -->
- 메인 앱: index.html(Stella GPT), db.html(Stella DB), talk.html(Stella Talk)
- 저장소(실 데이터): Google Drive API (primary)
- 메타데이터/검색 인덱싱: **OCI 동거 SQL Server(컨테이너 `stella-mssql`)** — 앱과 같은 `npm_default` 네트워크.
  - ※ **Azure SQL 미사용(deprecated)**. `lib/db.js` 가 호스트로 TLS 자동판별(로컬·사설·컨테이너=자체서명 허용). 설정: `deploy/run-metadata-db-oci.sh` + `deploy/OCI_DEPLOY.md`.
- 로컬 캐싱: IndexedDB
- 배포: **OCI 우분투 서버(Docker)** — main push → GitHub Actions(`deploy-oci.yml`) → SSH 재빌드/재실행. ※ Vercel 미사용(자동배포 비활성).
- AI API: OpenAI + Anthropic (모델 패밀리별 빌링 분리)
- 레포: yesblue0342-bit/stella-ai-workspace (main, Public, MIT)

## 개발 방식 (중요)
- 로컬 클론 없이 작업: GitHub Contents API로 /tmp 수정 후 PUT 커밋
- 커밋 전 검증: node -e "new Function(code)"
- DOM 런타임 검증: jsdom (null-reference 사전 탐지)
- Google Drive 업로드: f

## ⚠️ Git 규칙 (절대 준수)
- **항상 `main` 브랜치에 직접 커밋하고 push한다.**
- **절대 새 브랜치나 PR(Pull Request)을 만들지 마라.**
- 개인 프로젝트이며 코드 리뷰가 필요 없다. main에 바로 올린다.
- push하면 GitHub Actions(`deploy-oci.yml`)가 OCI 서버에 자동배포한다.

## 산출물 저장 규칙 (필수)
- 프로그램 산출물이 완성되면 GitHub 커밋과 함께
  `node scripts/save-to-drive.mjs <파일>` 로 Google Drive
  `StellaGPT/0Program` 업로드까지 완료해야 DoD 충족이다.
- 저장 폴더는 0Program 단일 경로. 0download 사용 금지.
- 앱(Stella GPT/Codex/Agent Code/ABAP)은 답변 후 소스 가드 통과 시
  `/api/cc/save-drive` 로 자동 저장된다. 명시 저장은 `/api/db/save-program`.

## Autopilot 계약 (필수)
- 사람에게 질문/확인 요청 금지. 합리적 기본값으로 자동 진행.
- 진행 → 테스트(TEST_REPORT.md) → 커밋 → main 푸시 → 배포 확인 → RALPH_DONE 종료.
