import { getPool, sql } from "../lib/db.js";
import {
  getDriveRootId,
  getDrive,
  findFolderByName,
  extractDriveFileText,
  FOLDER_MIME,
  normalizeDriveError
} from "../lib/drive-utils.js";

// ChatGPT 대화 백업 인덱서
// 백업 위치: 내 드라이브 > StellaGPT > chatgpt > chats (약 3,133건)
// 사용:
//   GET /api/index-chatgpt?action=count                 → 적재 건수
//   GET /api/index-chatgpt?offset=0&limit=100           → 100건씩 인덱싱(done:true까지 offset+=100)
//   GET /api/index-chatgpt?action=search&q=키워드        → 인덱스 검증 검색
//   (옵션) &folder=chatgpt/chats  또는  &folderId=<드라이브폴더ID>
export const config = { maxDuration: 300 };

const TABLE_DDL = `
IF OBJECT_ID('dbo.chatgpt_index','U') IS NULL
CREATE TABLE dbo.chatgpt_index(
  id INT IDENTITY(1,1) PRIMARY KEY,
  drive_file_id NVARCHAR(255) NOT NULL UNIQUE,
  title NVARCHAR(400) NULL,
  content NVARCHAR(MAX) NULL,
  file_name NVARCHAR(400) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);`;

// StellaGPT 루트(=getDriveRootId)에서 folder 경로(chatgpt/chats)를 따라 폴더 id 해석
async function resolveChatsFolderId(folderParam) {
  const parts = String(folderParam || "chatgpt/chats")
    .split(/[\/>]/).map((s) => s.trim()).filter(Boolean);
  let parentId = getDriveRootId();
  for (const p of parts) {
    const f = await findFolderByName(p, parentId);
    if (!f) {
      const err = new Error(`Drive 폴더를 찾지 못했습니다: "${p}" (상위 ${parentId}). 실제 폴더명을 ?folder= 또는 ?folderId= 로 지정하세요.`);
      err.code = "FOLDER_NOT_FOUND";
      throw err;
    }
    parentId = f.id;
  }
  return parentId;
}

// 폴더 내 파일 전체 메타데이터 수집(이름순 정렬 → offset 안정화)
async function listAllFiles(folderId) {
  const drive = getDrive();
  const out = [];
  let pageToken;
  do {
    const r = await drive.files.list({
      q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`,
      fields: "nextPageToken, files(id,name,mimeType)",
      orderBy: "name",
      pageSize: 1000,
      pageToken
    });
    (r.data.files || []).forEach((f) => out.push(f));
    pageToken = r.data.nextPageToken;
  } while (pageToken && out.length < 50000);
  out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return out;
}

// 파일 텍스트 → {title, content}. ChatGPT export(mapping) / messages 배열 / 일반 텍스트 모두 대응
function parseChat(name, raw) {
  let title = String(name || "").replace(/\.(json|txt|md|html?)$/i, "");
  let content = String(raw || "");
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") {
      if (j.title) title = String(j.title);
      const parts = [];
      if (j.mapping && typeof j.mapping === "object") {
        for (const k of Object.keys(j.mapping)) {
          const msg = j.mapping[k] && j.mapping[k].message;
          if (!msg) continue;
          const role = (msg.author && msg.author.role) || "";
          const ps = msg.content && Array.isArray(msg.content.parts) ? msg.content.parts : [];
          const t = ps.map((p) => (typeof p === "string" ? p : (p && p.text) || "")).join(" ").trim();
          if (t) parts.push((role ? role + ": " : "") + t);
        }
      } else if (Array.isArray(j.messages)) {
        for (const m of j.messages) {
          if (typeof m === "string") { parts.push(m); continue; }
          const t = m.text || m.content ||
            (m.content && m.content.parts && Array.isArray(m.content.parts) ? m.content.parts.join(" ") : "") || "";
          if (t) parts.push((m.role ? m.role + ": " : "") + String(t));
        }
      }
      if (parts.length) content = parts.join("\n");
    }
  } catch (e) { /* 일반 텍스트로 사용 */ }
  return { title: (title || "(제목없음)").slice(0, 400), content: content || "" };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const action = String(req.query.action || "index").toLowerCase();

    let pool;
    try {
      pool = await getPool();
      await pool.request().batch(TABLE_DDL);
    } catch (dbErr) {
      return res.status(500).json({ ok: false, action, error: "Azure SQL 연결/초기화 실패: " + (dbErr.message || dbErr) });
    }

    // 적재 건수
    if (action === "count") {
      const r = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.chatgpt_index");
      return res.status(200).json({ ok: true, action: "count", count: r.recordset[0].cnt });
    }

    // 인덱스 검증 검색
    if (action === "search") {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, action, error: "q(검색어)가 필요합니다." });
      const r = await pool.request()
        .input("kw", sql.NVarChar(400), "%" + q + "%")
        .query("SELECT TOP 10 id, drive_file_id, title, LEFT(content,300) AS snippet FROM dbo.chatgpt_index WHERE title LIKE @kw OR content LIKE @kw ORDER BY updated_at DESC");
      return res.status(200).json({ ok: true, action: "search", q, count: r.recordset.length, results: r.recordset });
    }

    // 페이지 단위 인덱싱
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "100", 10) || 100));

    let folderId;
    try {
      folderId = req.query.folderId ? String(req.query.folderId) : await resolveChatsFolderId(req.query.folder);
    } catch (fErr) {
      return res.status(200).json({ ok: false, action: "index", error: normalizeDriveError(fErr), code: fErr.code || "FOLDER_ERROR" });
    }

    const all = await listAllFiles(folderId);
    const total = all.length;
    const slice = all.slice(offset, offset + limit);

    let processed = 0, indexed = 0, skipped = 0;
    const errors = [];
    for (const f of slice) {
      try {
        const ext = await extractDriveFileText(f.id);
        const { title, content } = parseChat(f.name, ext.text || "");
        await pool.request()
          .input("fid", sql.NVarChar(255), f.id)
          .input("title", sql.NVarChar(400), title)
          .input("content", sql.NVarChar(sql.MAX), content.slice(0, 1000000))
          .input("fname", sql.NVarChar(400), String(f.name || "").slice(0, 400))
          .query(`MERGE dbo.chatgpt_index AS t
                  USING (SELECT @fid AS drive_file_id) AS s ON t.drive_file_id = s.drive_file_id
                  WHEN MATCHED THEN UPDATE SET title=@title, content=@content, file_name=@fname, updated_at=SYSUTCDATETIME()
                  WHEN NOT MATCHED THEN INSERT(drive_file_id,title,content,file_name) VALUES(@fid,@title,@content,@fname);`);
        indexed++;
      } catch (e) {
        skipped++;
        if (errors.length < 5) errors.push({ file: f.name, error: (e.message || String(e)).slice(0, 200) });
      }
      processed++;
    }

    const nextOffset = offset + limit;
    const done = nextOffset >= total;
    return res.status(200).json({
      ok: true,
      action: "index",
      folderId,
      total,
      offset,
      limit,
      processed,
      indexed,
      skipped,
      nextOffset: done ? null : nextOffset,
      done,
      errors
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "index-chatgpt error" });
  }
}
