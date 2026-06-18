// lib/memory-db.mjs — Stella 사용자 메모리 시스템 (Azure SQL 백엔드, ESM)
// 기존 lib/db.js 풀 재사용. 모든 함수 graceful: DB 미연결/실패 시 throw 없이 안전 기본값 반환
// (채팅은 계속 동작, 메모리만 생략 — 데이터 무결성·앱 안정성 우선).
import { getPool, sql } from "./db.js";

let _schemaReady = false;
async function ensureSchema(pool) {
  if (_schemaReady) return;
  await pool.request().query(`
    IF OBJECT_ID('dbo.ST_USERS','U') IS NULL
      CREATE TABLE dbo.ST_USERS (
        user_id NVARCHAR(128) NOT NULL PRIMARY KEY, email NVARCHAR(256) NULL,
        display_name NVARCHAR(128) NULL, auth_provider NVARCHAR(32) NOT NULL DEFAULT 'google',
        status NVARCHAR(16) NOT NULL DEFAULT 'active',
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
    IF OBJECT_ID('dbo.ST_USER_PROFILE','U') IS NULL
      CREATE TABLE dbo.ST_USER_PROFILE (
        user_id NVARCHAR(128) NOT NULL PRIMARY KEY, nickname NVARCHAR(128) NULL,
        preferred_language NVARCHAR(16) NOT NULL DEFAULT 'ko', occupation NVARCHAR(256) NULL,
        interests NVARCHAR(MAX) NULL, response_style NVARCHAR(64) NULL, ai_personality NVARCHAR(64) NULL,
        extra_json NVARCHAR(MAX) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
    IF OBJECT_ID('dbo.ST_USER_MEMORY','U') IS NULL
      CREATE TABLE dbo.ST_USER_MEMORY (
        memory_id BIGINT IDENTITY(1,1) PRIMARY KEY, user_id NVARCHAR(128) NOT NULL,
        memory_text NVARCHAR(MAX) NOT NULL, category NVARCHAR(64) NULL,
        app_scope NVARCHAR(32) NOT NULL DEFAULT 'shared', source NVARCHAR(32) NOT NULL DEFAULT 'user',
        confidence FLOAT NULL, is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_MEMORY_USER_ACTIVE')
      CREATE INDEX IX_MEMORY_USER_ACTIVE ON dbo.ST_USER_MEMORY(user_id, is_active, updated_at DESC);
    IF OBJECT_ID('dbo.ST_CHAT_HISTORY','U') IS NULL
      CREATE TABLE dbo.ST_CHAT_HISTORY (
        chat_id NVARCHAR(128) NOT NULL PRIMARY KEY, user_id NVARCHAR(128) NOT NULL,
        title NVARCHAR(512) NULL, summary NVARCHAR(MAX) NULL, source NVARCHAR(32) NOT NULL DEFAULT 'stella',
        drive_file_id NVARCHAR(256) NULL, message_count INT NOT NULL DEFAULT 0, keywords NVARCHAR(MAX) NULL,
        model NVARCHAR(64) NULL, started_at DATETIME2 NULL, last_message_at DATETIME2 NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_CHAT_USER_TIME')
      CREATE INDEX IX_CHAT_USER_TIME ON dbo.ST_CHAT_HISTORY(user_id, last_message_at DESC);
  `);
  _schemaReady = true;
}
async function withPool(fn, fallback) {
  try { const pool = await getPool(); await ensureSchema(pool); return await fn(pool); }
  catch (e) { return typeof fallback === "function" ? fallback(e) : fallback; }
}
const U = (v) => sql.NVarChar(128); // (가독성용 placeholder)

export async function upsertUser(userId, { email, name } = {}) {
  return withPool(async (pool) => {
    await pool.request()
      .input("uid", sql.NVarChar(128), userId)
      .input("email", sql.NVarChar(256), email || null)
      .input("name", sql.NVarChar(128), name || null)
      .query(`MERGE dbo.ST_USERS AS t USING (SELECT @uid AS user_id) s ON t.user_id=s.user_id
              WHEN MATCHED THEN UPDATE SET email=COALESCE(@email,email), display_name=COALESCE(@name,display_name), updated_at=SYSUTCDATETIME()
              WHEN NOT MATCHED THEN INSERT(user_id,email,display_name) VALUES(@uid,@email,@name);`);
    return true;
  }, false);
}

export async function saveProfile(userId, b = {}) {
  return withPool(async (pool) => {
    await upsertUser(userId);
    await pool.request()
      .input("uid", sql.NVarChar(128), userId)
      .input("nickname", sql.NVarChar(128), b.nickname ?? null)
      .input("lang", sql.NVarChar(16), b.preferred_language ?? "ko")
      .input("occ", sql.NVarChar(256), b.occupation ?? null)
      .input("interests", sql.NVarChar(sql.MAX), JSON.stringify(b.interests ?? []))
      .input("style", sql.NVarChar(64), b.response_style ?? null)
      .input("persona", sql.NVarChar(64), b.ai_personality ?? null)
      .input("extra", sql.NVarChar(sql.MAX), b.extra ? JSON.stringify(b.extra) : null)
      .query(`MERGE dbo.ST_USER_PROFILE AS t USING (SELECT @uid AS user_id) s ON t.user_id=s.user_id
              WHEN MATCHED THEN UPDATE SET nickname=@nickname, preferred_language=@lang, occupation=@occ,
                interests=@interests, response_style=@style, ai_personality=@persona, extra_json=@extra, updated_at=SYSUTCDATETIME()
              WHEN NOT MATCHED THEN INSERT(user_id,nickname,preferred_language,occupation,interests,response_style,ai_personality,extra_json)
                VALUES(@uid,@nickname,@lang,@occ,@interests,@style,@persona,@extra);`);
    return true;
  }, false);
}

export async function loadProfile(userId) {
  return withPool(async (pool) => {
    const r = await pool.request().input("uid", sql.NVarChar(128), userId)
      .query(`SELECT TOP 1 * FROM dbo.ST_USER_PROFILE WHERE user_id=@uid`);
    const row = r.recordset[0] || null;
    if (row && row.interests) { try { row.interests = JSON.parse(row.interests); } catch {} }
    return row;
  }, null);
}

export async function saveMemory(userId, { memory_text, category, app_scope, source } = {}) {
  const txt = String(memory_text || "").trim();
  if (!txt) return { ok: false, error: "memory_text required" };
  return withPool(async (pool) => {
    await upsertUser(userId);
    const dup = await pool.request()
      .input("uid", sql.NVarChar(128), userId).input("txt", sql.NVarChar(sql.MAX), txt)
      .query(`SELECT TOP 1 memory_id FROM dbo.ST_USER_MEMORY WHERE user_id=@uid AND is_active=1 AND memory_text=@txt`);
    if (dup.recordset.length) return { ok: true, deduped: true, memory_id: dup.recordset[0].memory_id };
    const ins = await pool.request()
      .input("uid", sql.NVarChar(128), userId).input("txt", sql.NVarChar(sql.MAX), txt)
      .input("cat", sql.NVarChar(64), category ?? "fact").input("scope", sql.NVarChar(32), app_scope ?? "shared")
      .input("src", sql.NVarChar(32), source ?? "user")
      .query(`INSERT INTO dbo.ST_USER_MEMORY (user_id,memory_text,category,app_scope,source)
              OUTPUT INSERTED.memory_id VALUES(@uid,@txt,@cat,@scope,@src)`);
    return { ok: true, memory_id: ins.recordset[0].memory_id };
  }, (e) => ({ ok: false, error: String(e && e.message || e) }));
}

export async function searchMemory(userId, q, limit = 50) {
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  return withPool(async (pool) => {
    const rq = pool.request().input("uid", sql.NVarChar(128), userId).input("lim", sql.Int, lim);
    let where = `user_id=@uid AND is_active=1`;
    if (q) { rq.input("q", sql.NVarChar(sql.MAX), `%${q}%`); where += ` AND memory_text LIKE @q`; }
    const r = await rq.query(`SELECT TOP (@lim) memory_id, memory_text, category, app_scope, source, created_at, updated_at
                              FROM dbo.ST_USER_MEMORY WHERE ${where} ORDER BY updated_at DESC`);
    return r.recordset;
  }, []);
}

export async function updateMemory(userId, memory_id, { memory_text, category, is_active } = {}) {
  if (!memory_id) return { ok: false, error: "memory_id required" };
  return withPool(async (pool) => {
    const r = await pool.request()
      .input("uid", sql.NVarChar(128), userId).input("mid", sql.BigInt, memory_id)
      .input("txt", sql.NVarChar(sql.MAX), memory_text ?? null).input("cat", sql.NVarChar(64), category ?? null)
      .input("act", sql.Bit, typeof is_active === "boolean" ? is_active : null)
      .query(`UPDATE dbo.ST_USER_MEMORY SET memory_text=COALESCE(@txt,memory_text), category=COALESCE(@cat,category),
                is_active=COALESCE(@act,is_active), updated_at=SYSUTCDATETIME()
              WHERE memory_id=@mid AND user_id=@uid; SELECT @@ROWCOUNT AS affected;`);
    return { ok: !!r.recordset[0].affected, affected: r.recordset[0].affected };
  }, (e) => ({ ok: false, error: String(e && e.message || e) }));
}

export async function saveChatHistory(userId, b = {}) {
  if (!b.chat_id) return { ok: false, error: "chat_id required" };
  return withPool(async (pool) => {
    await upsertUser(userId);
    await pool.request()
      .input("cid", sql.NVarChar(128), b.chat_id).input("uid", sql.NVarChar(128), userId)
      .input("title", sql.NVarChar(512), b.title ?? null).input("summary", sql.NVarChar(sql.MAX), b.summary ?? null)
      .input("src", sql.NVarChar(32), b.source ?? "stella").input("drive", sql.NVarChar(256), b.drive_file_id ?? null)
      .input("cnt", sql.Int, b.message_count ?? 0).input("kw", sql.NVarChar(sql.MAX), b.keywords ?? null)
      .input("model", sql.NVarChar(64), b.model ?? null)
      .input("last", sql.DateTime2, b.last_message_at ? new Date(b.last_message_at) : new Date())
      .query(`MERGE dbo.ST_CHAT_HISTORY AS t USING (SELECT @cid AS chat_id) s ON t.chat_id=s.chat_id
              WHEN MATCHED THEN UPDATE SET title=@title, summary=@summary, drive_file_id=@drive, message_count=@cnt,
                keywords=@kw, model=@model, last_message_at=@last, updated_at=SYSUTCDATETIME()
              WHEN NOT MATCHED THEN INSERT(chat_id,user_id,title,summary,source,drive_file_id,message_count,keywords,model,last_message_at)
                VALUES(@cid,@uid,@title,@summary,@src,@drive,@cnt,@kw,@model,@last);`);
    return { ok: true };
  }, (e) => ({ ok: false, error: String(e && e.message || e) }));
}

export async function listChatHistory(userId, q, limit = 30) {
  const lim = Math.min(parseInt(limit, 10) || 30, 100);
  return withPool(async (pool) => {
    const rq = pool.request().input("uid", sql.NVarChar(128), userId).input("lim", sql.Int, lim);
    let where = `user_id=@uid`;
    if (q) { rq.input("q", sql.NVarChar(sql.MAX), `%${q}%`); where += ` AND (title LIKE @q OR keywords LIKE @q OR summary LIKE @q)`; }
    const r = await rq.query(`SELECT TOP (@lim) chat_id,title,summary,source,drive_file_id,message_count,model,last_message_at
                              FROM dbo.ST_CHAT_HISTORY WHERE ${where} ORDER BY last_message_at DESC`);
    return r.recordset;
  }, []);
}

// 메모리 → system prompt 블록 (Azure 기반). 실패/빈값이면 "" 반환(채팅은 정상).
export async function buildMemoryContext(userId, { memLimit = 30 } = {}) {
  return withPool(async (pool) => {
    const [prof, mem, chat] = await Promise.all([
      pool.request().input("uid", sql.NVarChar(128), userId).query(`SELECT TOP 1 * FROM dbo.ST_USER_PROFILE WHERE user_id=@uid`),
      pool.request().input("uid", sql.NVarChar(128), userId).input("lim", sql.Int, memLimit)
        .query(`SELECT TOP (@lim) memory_text FROM dbo.ST_USER_MEMORY WHERE user_id=@uid AND is_active=1 ORDER BY updated_at DESC`),
      pool.request().input("uid", sql.NVarChar(128), userId).query(`SELECT TOP 5 title, summary FROM dbo.ST_CHAT_HISTORY WHERE user_id=@uid ORDER BY last_message_at DESC`),
    ]);
    const p = prof.recordset[0];
    let ctx = "";
    if (p) {
      let interests = p.interests; try { interests = JSON.parse(p.interests).join(", "); } catch {}
      ctx += "[USER PROFILE]\n";
      if (p.nickname) ctx += `Nickname: ${p.nickname}\n`;
      if (p.occupation) ctx += `Occupation: ${p.occupation}\n`;
      if (interests) ctx += `Interests: ${interests}\n`;
      if (p.preferred_language) ctx += `Language: ${p.preferred_language}\n`;
      if (p.response_style) ctx += `Response style: ${p.response_style}\n`;
      if (p.ai_personality) ctx += `AI personality: ${p.ai_personality}\n`;
      ctx += "\n";
    }
    if (mem.recordset.length) ctx += "[MEMORY]\n" + mem.recordset.map(m => `- ${m.memory_text}`).join("\n") + "\n\n";
    if (chat.recordset.length) ctx += "[RECENT CHATS]\n" + chat.recordset.map(c => `- ${c.title || "(untitled)"}: ${c.summary || ""}`).join("\n") + "\n";
    return ctx.trim();
  }, "");
}

export default {
  upsertUser, saveProfile, loadProfile, saveMemory, searchMemory, updateMemory,
  saveChatHistory, listChatHistory, buildMemoryContext,
};
