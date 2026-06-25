import sql from "mssql";
import { withRetry } from "./retry.js";

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

// env 불리언: 미설정이면 undefined, 설정되면 true/false. (1/true/yes/on → true)
function envBool(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v != null && String(v).trim() !== "") {
      return /^(1|true|yes|on)$/i.test(String(v).trim());
    }
  }
  return undefined;
}

// Azure SQL 호스트(*.database.windows.net)인가
function isAzureServer(server) {
  return /\.database\.windows\.net$/i.test(String(server || "").trim());
}

// 로컬/사설/컨테이너 호스트인가 — OCI 동거 메타DB(자체서명 인증서)는 여기로 분류.
// localhost·127.0.0.1·점없는 컨테이너명(stella-mssql 등)·사설/CGNAT IPv4 대역.
function isLocalOrPrivateServer(server) {
  const s = String(server || "").trim().toLowerCase();
  if (!s) return false;
  if (s === "localhost" || s === "127.0.0.1" || s === "::1") return true;
  if (!s.includes(".")) return true;                       // 컨테이너/내부 호스트명
  if (/^10\./.test(s)) return true;
  if (/^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(s)) return true; // Tailscale/CGNAT
  return false;
}

// TLS 옵션 결정 — 기본은 호스트로 자동 판별, 환경변수로 명시 오버라이드 가능.
//  · Azure(*.database.windows.net): 암호화 O / 인증서 검증 O  (기존 동작 100% 유지)
//  · 로컬·사설·컨테이너(OCI 동거 DB): 암호화 O / 자체서명 허용(trustServerCertificate)
//  · 그 외 공개 호스트: 암호화 O / 검증 O
//  오버라이드: DB_ENCRYPT, DB_TRUST_SERVER_CERT(별칭 DB_TRUST_CERT / SQL_TRUST_SERVER_CERTIFICATE)
function resolveTlsOptions(server) {
  const azure = isAzureServer(server);
  const local = isLocalOrPrivateServer(server);

  let encrypt = true;
  let trustServerCertificate = azure ? false : local ? true : false;

  const encOverride = envBool("DB_ENCRYPT", "SQL_ENCRYPT");
  if (encOverride !== undefined) encrypt = encOverride;

  const trustOverride = envBool("DB_TRUST_SERVER_CERT", "DB_TRUST_CERT", "SQL_TRUST_SERVER_CERTIFICATE");
  if (trustOverride !== undefined) trustServerCertificate = trustOverride;

  return { encrypt, trustServerCertificate, enableArithAbort: true };
}

// 연결 대상 요약(시크릿 제외) — health 표시용. mode: azure | oci-local | custom | connection-string
export function describeDbTarget() {
  const cs = firstEnv("SQL_CONNECTION_STRING", "AZURE_SQL_CONNECTION_STRING", "AZURE_SQL_CONNECTIONSTRING", "DATABASE_URL", "DB_CONNECTION_STRING");
  if (cs) return { mode: "connection-string", server: null };
  const server = firstEnv("DB_SERVER", "SQL_SERVER", "AZURE_SQL_SERVER", "CL_DB_SV").replace(/^tcp:/i, "").split(",")[0];
  let mode = "custom";
  if (isAzureServer(server)) mode = "azure";
  else if (isLocalOrPrivateServer(server)) mode = "oci-local";
  return { mode, server: server || null, ...resolveTlsOptions(server) };
}

export function buildDbConfig() {
  const connectionString = firstEnv(
    "SQL_CONNECTION_STRING",
    "AZURE_SQL_CONNECTION_STRING",
    "AZURE_SQL_CONNECTIONSTRING",
    "DATABASE_URL",
    "DB_CONNECTION_STRING"
  );

  if (connectionString) return connectionString;

  const user = firstEnv("DB_USER", "SQL_USER", "AZURE_SQL_USER", "CL_DB_USR");
  const password = firstEnv("DB_PASSWORD", "SQL_PASSWORD", "AZURE_SQL_PASSWORD", "CL_DB_PW");
  const server = firstEnv("DB_SERVER", "SQL_SERVER", "AZURE_SQL_SERVER", "CL_DB_SV").replace(/^tcp:/i, "").split(",")[0];
  const database = firstEnv("DB_NAME", "DB_DATABASE", "SQL_DATABASE", "AZURE_SQL_DATABASE", "CL_DB_NM");
  const port = Number(firstEnv("DB_PORT", "SQL_PORT") || 1433);

  const missing = [];
  if (!user) missing.push("DB_USER");
  if (!password) missing.push("DB_PASSWORD");
  if (!server) missing.push("DB_SERVER");
  if (!database) missing.push("DB_NAME");

  if (missing.length) {
    const error = new Error(`메타데이터 DB 환경변수가 누락되었습니다: ${missing.join(", ")}`);
    error.code = "STELLA_DB_ENV_MISSING";
    throw error;
  }

  return {
    user,
    password,
    server,
    database,
    port,
    connectionTimeout: 60000,
    requestTimeout: 60000,
    options: resolveTlsOptions(server)
  };
}

// 재시도 유틸은 lib/retry.js 에서 가져와 그대로 재노출 (api/* 호환 유지).
export { withRetry };

let poolPromise;

// 연결 풀 확보 (콜드 스타트 대응: 최대 3회 재시도, 실패 시 풀 캐시 초기화).
export async function getPool() {
  if (!poolPromise) {
    const config = buildDbConfig();
    poolPromise = withRetry(() => sql.connect(config), {
      retries: 3,
      baseDelay: 500,
      onRetry: (err, attempt) => {
        console.warn(`[db] 연결 재시도 ${attempt}/3:`, err && err.message);
      }
    }).catch((error) => {
      poolPromise = null; // 다음 호출에서 새 연결 시도 가능하도록
      throw error;
    });
  }
  return poolPromise;
}

// 워밍업 핑: SELECT 1 을 재시도와 함께 실행해 서버리스 콜드 스타트를 미리 깨운다.
// 성공 시 true, 실패해도 throw 하지 않고 false 반환(앱 흐름 차단 금지).
export async function warmup() {
  try {
    return await withRetry(async () => {
      const pool = await getPool();
      await pool.request().query("SELECT 1 AS warm");
      return true;
    }, { retries: 3, baseDelay: 500 });
  } catch (error) {
    console.warn("[db] warmup 실패:", error && error.message);
    return false;
  }
}

export { sql };
