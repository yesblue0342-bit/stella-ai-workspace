#!/usr/bin/env bash
#
# Stella AI Workspace — OCI 배포 (seo.이후.com 과 동일한 npm_default 패턴)
# 사전: /opt/stella-ai-workspace 에 clone + .env 작성 완료 상태
# 실행: bash deploy/run-stella-oci.sh
#
set -euo pipefail

NAME=stella-workspace
NETWORK=npm_default
PORT=8970

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

echo "▶ 1/5 .env 확인"
if [ ! -f .env ]; then
  echo "  ❌ .env 가 없습니다. 먼저 작성하세요:"
  echo "     cp .env.example .env  &&  nano .env"
  echo "     (또는 Vercel에서: vercel env pull .env)"
  exit 1
fi
echo "  ✅ .env 존재"

echo "▶ 2/5 이미지 빌드 (Node deps 설치 — 수 분 소요 가능)"
sudo docker build -t "$NAME" .

echo "▶ 3/5 기존 컨테이너 정리"
sudo docker rm -f "$NAME" 2>/dev/null || true

echo "▶ 4/5 $NETWORK 네트워크에 컨테이너 실행 (.env 주입)"
sudo docker run -d --name "$NAME" \
  --network "$NETWORK" \
  --env-file .env \
  --restart unless-stopped \
  "$NAME"

echo "▶ 5/5 헬스체크 (12초 대기)"
sleep 12
if sudo docker exec "$NAME" curl -fsS "http://127.0.0.1:$PORT/" >/dev/null; then
  echo "  ✅ 컨테이너 내부 정상 (정적 서빙 OK)"
else
  echo "  ⚠️ 응답 없음 — 로그 확인: sudo docker logs $NAME --tail 50"
fi

echo ""
echo "🎉 빌드/실행 완료. 이제 NPM 에서 Proxy Host 추가:"
echo "   Domain          : stella.xn--hu5b23z.com"
echo "   Forward Host/IP : $NAME"
echo "   Forward Port    : $PORT"
echo "   (Websockets Support 켜기 — SSE 스트리밍용)"
echo "   SSL 탭 → Request a new Certificate → Force SSL → Save"
echo ""
echo "API 동작 확인: sudo docker exec $NAME curl -s http://127.0.0.1:$PORT/api/health"
