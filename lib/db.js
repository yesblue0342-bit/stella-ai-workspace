import sql from "mssql";

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

let poolPromise;

export async function getPool() {
  if (!poolPromise) {
    const config = buildDbConfig();
    poolPromise = sql.connect(config).catch((error) => {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
}

export { sql };
