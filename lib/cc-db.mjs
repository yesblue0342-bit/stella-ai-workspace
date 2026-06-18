// lib/cc-db.mjs — Stella Agent Code 세션 메타/캐시 (Azure SQL). 기존 lib/db.js 풀 재사용.
// 모든 함수는 graceful: DB 없거나 실패해도 throw 안 함(세션은 계속 동작, 영속만 생략).
import { getPool, sql } from "./db.js";

const OWNER = "kh"; // 단일 사용자 고정

async function ensureSchema(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='cc_meta')
      CREATE TABLE cc_meta (k NVARCHAR(120) PRIMARY KEY, v NVARCHAR(400), updated_at DATETIME2 DEFAULT SYSUTCDATETIME());
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='cc_sessions')
      CREATE TABLE cc_sessions (
        id NVARCHAR(120) PRIMARY KEY, owner NVARCHAR(60), title NVARCHAR(300), model NVARCHAR(80),
        agent_id NVARCHAR(120), environment_id NVARCHAR(120), status NVARCHAR(40),
        drive_file_id NVARCHAR(200), cost_usd FLOAT DEFAULT 0, budget_usd FLOAT,
        created_at DATETIME2 DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 DEFAULT SYSUTCDATETIME());
  `);
}

export async function getMeta(k) {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    const r = await pool.request().input("k", sql.NVarChar(120), k).query("SELECT v FROM cc_meta WHERE k=@k");
    return (r.recordset[0] && r.recordset[0].v) || null;
  } catch { return null; }
}
export async function setMeta(k, v) {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    await pool.request().input("k", sql.NVarChar(120), k).input("v", sql.NVarChar(400), String(v))
      .query("MERGE cc_meta AS t USING (SELECT @k AS k, @v AS v) s ON t.k=s.k WHEN MATCHED THEN UPDATE SET v=s.v, updated_at=SYSUTCDATETIME() WHEN NOT MATCHED THEN INSERT(k,v) VALUES(s.k,s.v);");
  } catch { /* graceful */ }
}
export async function saveSession(row) {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    await pool.request()
      .input("id", sql.NVarChar(120), row.id)
      .input("owner", sql.NVarChar(60), OWNER)
      .input("title", sql.NVarChar(300), row.title || "")
      .input("model", sql.NVarChar(80), row.model || "")
      .input("agent", sql.NVarChar(120), row.agentId || "")
      .input("env", sql.NVarChar(120), row.environmentId || "")
      .input("status", sql.NVarChar(40), row.status || "running")
      .input("fid", sql.NVarChar(200), row.driveFileId || "")
      .input("cost", sql.Float, Number(row.costUsd) || 0)
      .input("budget", sql.Float, Number(row.budgetUsd) || 0)
      .query("MERGE cc_sessions AS t USING (SELECT @id AS id) s ON t.id=s.id WHEN MATCHED THEN UPDATE SET title=@title, model=@model, agent_id=@agent, environment_id=@env, status=@status, drive_file_id=@fid, cost_usd=@cost, budget_usd=@budget, updated_at=SYSUTCDATETIME() WHEN NOT MATCHED THEN INSERT(id,owner,title,model,agent_id,environment_id,status,drive_file_id,cost_usd,budget_usd) VALUES(@id,@owner,@title,@model,@agent,@env,@status,@fid,@cost,@budget);");
  } catch { /* graceful */ }
}
export async function listSessions() {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    const r = await pool.request().query("SELECT TOP 50 id,title,model,status,cost_usd,budget_usd,drive_file_id,created_at,updated_at FROM cc_sessions ORDER BY updated_at DESC");
    return r.recordset || [];
  } catch { return []; }
}
export async function getSessionRow(id) {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    const r = await pool.request().input("id", sql.NVarChar(120), id).query("SELECT TOP 1 * FROM cc_sessions WHERE id=@id");
    return r.recordset[0] || null;
  } catch { return null; }
}

export default { getMeta, setMeta, saveSession, listSessions, getSessionRow };
