# Stella AI Workspace

OCI(Oracle Cloud) 우분투 서버 Docker 배포 구성입니다. **Vercel 미사용.**

## 파일 구성
- `index.html`: 화면
- `api/chat.js`: OpenAI API 호출
- `api/export.js`: TXT/HTML/XLSX 다운로드용 서버 API
- `package.json`: 의존성

## 배포
`main` push → GitHub Actions(`.github/workflows/deploy-oci.yml`) → SSH로 OCI 서버 재빌드/재실행. 시크릿·환경변수는 OCI 서버 `.env`로만 관리(코드/문서에 평문 저장 금지). 자세한 내용은 `CLAUDE.md` 참고.
