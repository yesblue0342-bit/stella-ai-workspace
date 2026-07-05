# Stella AI Workspace — OCI 구동 (Node 서버, Vercel 함수 어댑터)
FROM node:22-slim
# git: Stella Codex(/codex) 무인 자동화가 이 컨테이너 안에서 직접 레포를 clone/commit/push 한다
# (lib/codex-workspace.mjs) — Anthropic Managed Agents(cc 전용)와 달리 OpenAI 쪽엔 호스팅 샌드박스가 없어
# 이 서버 프로세스가 git 바이너리를 직접 실행해야 한다.
# ca-certificates: --no-install-recommends 때문에 git 설치 시 함께 깔리지 않아, 컨테이너 안 git이
# github.com TLS 인증서를 검증할 CA 파일이 없어 clone이 전부 "server certificate verification failed.
# CAfile: ..." 로 실패했다(Node fetch는 자체 내장 CA라 정상, git 바이너리만 시스템 CA 필요).
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm install --no-audit --no-fund express@4 cookie-parser
COPY . .
ENV PORT=8970
EXPOSE 8970
# 컨테이너 alive 체크 (정적 루트는 시크릿 없이도 200)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD curl -fsS http://127.0.0.1:8970/ >/dev/null || exit 1
CMD ["node", "server.mjs"]
