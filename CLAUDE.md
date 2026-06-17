# Stella AI Workspace

## 프로젝트 개요
GITHUB_TOKEN=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 GITHUB_REPO=https://github com/yesblue0342/my-vibe-project.git
- 메인 앱: index.html(Stella GPT), db.html(Stella DB), talk.html(Stella Talk)
- 저장소: Google Drive API (primary)
- 검색 인덱싱: Azure SQL
- 로컬 캐싱: IndexedDB
- 배포: Vercel (서버리스, 페이로드 한도 ~4.5MB 주의)
- AI API: OpenAI + Anthropic (모델 패밀리별 빌링 분리)
- 레포: yesblue0342-bit/stella-ai-workspace (main, Public, MIT)

## 개발 방식 (중요)
- 로컬 클론 없이 작업: GitHub Contents API로 /tmp 수정 후 PUT 커밋
- 커밋 전 검증: node -e "new Function(code)"
- DOM 런타임 검증: jsdom (null-reference 사전 탐지)
- Google Drive 업로드: f
