import sql from "mssql";
import { withRetry } from "./retry.js";

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function buildDbConfig() {
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
    const error = new Error(`Azure SQL 환경변수가 누락되었습니다: ${missing.join(", ")}`);
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
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true
    }
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
