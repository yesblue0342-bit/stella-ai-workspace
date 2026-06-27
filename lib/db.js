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

// 캐시된 풀을 버린다(다음 getPool 호출에서 새 연결). 컨테이너 재시작/소켓 단절 후 자가 치유.
export function resetPool(reason) {
  if (poolPromise) {
    console.warn("[db] 풀 무효화(재연결 예약):", reason || "unknown");
    poolPromise = null;
  }
}

// 끊긴/치명적 연결 에러인가 — 이 경우 풀을 폐기하고 재연결해야 한다(쿼리 1회 재시도).
// mssql/tedious 에러코드 + 메시지 패턴 기반(순수 함수, 단위 테스트 가능).
export function isPoolDeadError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  if (["ECONNCLOSED", "ECONNRESET", "ETIMEOUT", "ENOTOPEN", "ESOCKET", "EPIPE", "ENOTFOUND", "ECONNREFUSED"].includes(code)) {
    return true;
  }
  const msg = String(error.message || "").toLowerCase();
  return /connection is closed|connection lost|connection to .* is closed|pool is draining|not connected|socket hang up|closed pool|globalconnection.*not.*connect|requesterror.*connection/i.test(msg);
}

// 캐시된 풀을 그대로 재사용해도 되는가 — 연결됨/연결중이면 재사용, 닫힘이면 폐기.
// (mssql ConnectionPool: connected/connecting 불리언. 둘 다 false면 죽은 풀.)
export function shouldReusePool(pool) {
  if (!pool) return false;
  if (pool.connected === true || pool.connecting === true) return true;
  // 일부 버전은 connected/connecting 미노출 → 보수적으로 재사용(실패 시 쿼리단 재시도가 처리).
  if (pool.connected === undefined && pool.connecting === undefined) return true;
  return false;
}

// 연결 풀 확보 (콜드 스타트 대응: 최대 3회 재시도, 실패 시 풀 캐시 초기화).
// 추가: 기존 풀이 죽었으면 폐기 후 재연결 + 풀 error/close 시 캐시 자동 무효화.
export async function getPool() {
  if (poolPromise) {
    try {
      const existing = await poolPromise;
      if (shouldReusePool(existing)) return existing;
      resetPool("기존 풀 닫힘 감지");
    } catch (_) {
      poolPromise = null; // 이전 연결 시도 실패 캐시 → 새로 연결
    }
  }
  if (!poolPromise) {
    const config = buildDbConfig();
    poolPromise = withRetry(() => sql.connect(config), {
      retries: 3,
      baseDelay: 500,
      onRetry: (err, attempt) => {
        console.warn(`[db] 연결 재시도 ${attempt}/3:`, err && err.message);
      }
    }).then((pool) => {
      // 풀이 죽으면 캐시를 비워 다음 호출에서 재연결되게 한다(자가 치유).
      if (pool && typeof pool.on === "function") {
        pool.on("error", (err) => resetPool((err && err.message) || "pool error"));
        pool.on("close", () => resetPool("pool closed"));
      }
      return pool;
    }).catch((error) => {
      poolPromise = null; // 다음 호출에서 새 연결 시도 가능하도록
      throw error;
    });
  }
  return poolPromise;
}

// 풀을 받아 콜백을 실행하고, 연결 끊김(dead-pool) 에러면 풀을 폐기 후 1회 재연결·재시도.
// 멱등한 읽기/MERGE 에 사용(getPool().request() 직접 호출 대비 회복력 ↑). 호환을 위해 선택적.
export async function withPool(fn) {
  try {
    return await fn(await getPool());
  } catch (error) {
    if (!isPoolDeadError(error)) throw error;
    resetPool((error && error.message) || "dead pool on query");
    return await fn(await getPool()); // 새 연결로 1회 재시도
  }
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
