import requests
import base64
import json

# ===== 설정 (여기만 채우면 됨) =====
GITHUB_TOKEN=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
GITHUB_REPO=https://github
com/yesblue0342/my-vibe-project.git
OWNER  = "yesblue0342-bit"        # GitHub 사용자명
REPO   = "Leehu"                  # 레포명
PATH   = "Claude_config.md"       # 생성할 파일 경로
BRANCH = "main"                   # 브랜치
TOKEN  = "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"       # GitHub Personal Access Token
# ====================================

# 파일 내용
content = """# Claude Config

## 프로젝트 정보
- 이름: Stella AI Workspa
