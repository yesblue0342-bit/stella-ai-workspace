// lib/codex-db.mjs — Stella Codex 대화 이력 (Azure/OCI SQL 공용 풀 재사용, lib/cc-db.mjs와 동일 패턴).
// OpenAI Chat Completions는 세션을 서버에 보관하지 않는(무상태) API라 cc처럼 "메타데이터만 DB에 두고
// 실제 내용은 제공자 쪽에서 다시 불러오는" 방식이 불가능하다 — 전체 messages 배열을 통째로 저장한다.
// 모든 함수는 graceful: DB 없거나 실패해도 throw 안 함(로컬 localStorage 폴백으로 계속 동작).
import { getPool, sql } from "./db.js";

const OWNER = "kh"; // 단일 사용자 고정(cc-db.mjs와 동일 컨벤션)
const MAX_MESSAGES_JSON_CHARS = 4_000_000; // 극단적 폭주 방지 상한(약 4MB)

async function ensureSchema(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='codex_chats')
      CREATE TABLE codex_chats (
        id NVARCHAR(120) PRIMARY KEY, owner NVARCHAR(60), title NVARCHAR(300), model NVARCHAR(80),
        messages_json NVARCHAR(MAX),
        created_at DATETIME2 DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 DEFAULT SYSUTCDATETIME());
  `);
}

export async function listCodexChats() {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    const r = await pool.request().query("SELECT TOP 50 id,title,model,updated_at FROM codex_chats ORDER BY updated_at DESC");
    return r.recordset || [];
  } catch { return []; }
}

export async function getCodexChat(id) {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    const r = await pool.request().input("id", sql.NVarChar(120), id).query("SELECT TOP 1 * FROM codex_chats WHERE id=@id");
    const row = r.recordset[0];
    if (!row) return null;
    let messages = [];
    try { messages = JSON.parse(row.messages_json || "[]"); } catch { messages = []; }
    return { id: row.id, title: row.title, model: row.model, messages, updatedAt: row.updated_at };
  } catch { return null; }
}

export async function saveCodexChat({ id, title, model, messages }) {
  try {
    const pool = await getPool(); await ensureSchema(pool);
    const json = JSON.stringify(Array.isArray(messages) ? messages : []).slice(0, MAX_MESSAGES_JSON_CHARS);
    await pool.request()
      .input("id", sql.NVarChar(120), id)
      .input("owner", sql.NVarChar(60), OWNER)
      .input("title", sql.NVarChar(300), String(title || "").slice(0, 300))
      .input("model", sql.NVarChar(80), String(model || "").slice(0, 80))
      .input("mjson", sql.NVarChar(sql.MAX), json)
      .query(
        "MERGE codex_chats AS t USING (SELECT @id AS id) s ON t.id=s.id " +
        "WHEN MATCHED THEN UPDATE SET title=@title, model=@model, messages_json=@mjson, updated_at=SYSUTCDATETIME() " +
        "WHEN NOT MATCHED THEN INSERT(id,owner,title,model,messages_json) VALUES(@id,@owner,@title,@model,@mjson);"
      );
    return true;
  } catch (e) { console.error("[codex-db] saveCodexChat 실패(graceful, 로컬만 유지):", e && e.message); return false; }
}

export default { listCodexChats, getCodexChat, saveCodexChat };
