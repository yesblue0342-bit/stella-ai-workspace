#!/usr/bin/env bash
#
# Stella 메타데이터 DB — OCI 동거(co-located) 설정 (최초 1회)
# Azure SQL 의 콜드스타트/auto-pause 골치를 없애려고 메타데이터(검색 인덱스)를
# 앱과 같은 OCI 서버의 docker 컨테이너로 옮긴다. 실 데이터는 그대로 Google Drive.
#
# 앱 컨테이너(stella-workspace)와 같은 npm_default 네트워크에 띄우므로,
# 앱에서는 DB_SERVER=stella-mssql (컨테이너명) 으로 접속한다.
#
# 사용법:
#   1) /opt/stella-ai-workspace/.env 에 아래를 넣는다(예):
#        DB_SERVER=stella-mssql
#        DB_PORT=1433
#        DB_USER=sa
#        DB_PASSWORD=<강한_비밀번호_8자+대소문자+숫자+기호>
#        DB_NAME=stella
#        DB_TRUST_SERVER_CERT=true     # 자체서명 인증서 허용(코드 자동판별도 됨)
#   2) bash deploy/run-metadata-db-oci.sh
#   3) 앱 재배포(또는 자동) → /api/health 가 mode:"oci-local" 로 정상.
#
set -euo pipefail

NAME=stella-mssql
NETWORK=npm_default
VOLUME=stella-mssql-data
# Azure SQL Edge: TDS/T-SQL 호환, ARM64(OCI Ampere) 지원. x86 서버면
# MSSQL_IMAGE=mcr.microsoft.com/mssql/server:2022-latest 로 바꿔도 됨(SA 비번 동일).
IMAGE="${MSSQL_IMAGE:-mcr.microsoft.com/azure-sql-edge:latest}"

cd "$(dirname "$0")/.."

# docker 권한(앱 배포 스크립트와 동일 패턴: docker 그룹이면 sudo 불필요)
if docker info >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi

# .env 에서 DB 값 읽기(없으면 환경변수)
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi
SA_PW="${DB_PASSWORD:-${SA_PASSWORD:-}}"
DB_LOGIN="${DB_USER:-sa}"
DB="${DB_NAME:-stella}"
if [ -z "${SA_PW}" ]; then
  echo "❌ DB_PASSWORD(.env) 또는 SA_PASSWORD 환경변수가 필요합니다(SQL Server SA 비밀번호)." >&2
  echo "   8자 이상 + 대문자/소문자/숫자/기호 포함이어야 SQL Server 가 기동됩니다." >&2
  exit 1
fi

echo "▶ 1/4 네트워크/볼륨 확인 ($NETWORK, $VOLUME)"
$DOCKER network inspect "$NETWORK" >/dev/null 2>&1 || $DOCKER network create "$NETWORK"
$DOCKER volume inspect "$VOLUME" >/dev/null 2>&1 || $DOCKER volume create "$VOLUME"

echo "▶ 2/4 메타DB 컨테이너 실행 ($NAME, $IMAGE)"
$DOCKER rm -f "$NAME" 2>/dev/null || true
$DOCKER run -d --name "$NAME" \
  --network "$NETWORK" \
  --restart unless-stopped \
  -e "ACCEPT_EULA=1" \
  -e "MSSQL_SA_PASSWORD=${SA_PW}" \
  -e "SA_PASSWORD=${SA_PW}" \
  -v "${VOLUME}:/var/opt/mssql" \
  -p 127.0.0.1:1433:1433 \
  "$IMAGE"

echo "▶ 3/4 기동 대기(최대 60초)"
for i in $(seq 1 30); do
  if $DOCKER exec "$NAME" bash -lc 'exec 3<>/dev/tcp/127.0.0.1/1433' 2>/dev/null; then
    echo "  ✅ 1433 LISTEN 확인"; break
  fi
  sleep 2
  [ "$i" = "30" ] && echo "  ⚠️ 기동 지연 — 로그: $DOCKER logs $NAME --tail 50"
done
sleep 3

echo "▶ 4/4 데이터베이스 '$DB' 없으면 생성 (앱의 node+mssql 재사용)"
TMP_MJS="$(mktemp --suffix=.mjs)"
trap 'rm -f "$TMP_MJS"' EXIT
cat > "$TMP_MJS" <<'NODE'
import sql from "mssql";
const db = process.env.TARGET_DB;
const cfg = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD,
  server: "127.0.0.1",
  port: 1433,
  database: "master",
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};
const pool = await sql.connect(cfg);
// DB명에 대괄호/따옴표 방어
const safe = String(db).replace(/[^A-Za-z0-9_]/g, "");
await pool.request().query(`IF DB_ID(N'${safe}') IS NULL CREATE DATABASE [${safe}]`);
console.log("  ✅ DB 준비 완료:", safe);
await pool.close();
NODE
TARGET_DB="$DB" DB_USER="$DB_LOGIN" DB_PASSWORD="$SA_PW" node "$TMP_MJS"

echo ""
echo "🎉 메타데이터 DB 준비 완료."
echo "   앱(.env): DB_SERVER=$NAME  DB_PORT=1433  DB_USER=$DB_LOGIN  DB_NAME=$DB  DB_TRUST_SERVER_CERT=true"
echo "   확인: $DOCKER exec stella-workspace curl -s http://127.0.0.1:8970/api/health"
echo "   (health.target.mode 가 'oci-local' 이면 OCI 동거 DB로 전환 완료)"
