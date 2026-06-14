import { getPool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT SYSUTCDATETIME() AS db_time");
    return res.status(200).json({
      ok: true,
      message: "Stella API / Azure SQL 연결 정상",
      db_time: result.recordset?.[0]?.db_time || null,
      env: {
        hasConnectionString: Boolean(process.env.SQL_CONNECTION_STRING || process.env.AZURE_SQL_CONNECTION_STRING || process.env.AZURE_SQL_CONNECTIONSTRING || process.env.DATABASE_URL || process.env.DB_CONNECTION_STRING),
        hasDbUser: Boolean(process.env.DB_USER || process.env.SQL_USER || process.env.AZURE_SQL_USER),
        hasDbServer: Boolean(process.env.DB_SERVER || process.env.SQL_SERVER || process.env.AZURE_SQL_SERVER),
        hasDbName: Boolean(process.env.DB_NAME || process.env.DB_DATABASE || process.env.SQL_DATABASE || process.env.AZURE_SQL_DATABASE)
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Stella API / Azure SQL 연결 실패",
      error: error.message,
      code: error.code || null
    });
  }
}
