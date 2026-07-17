import { getPool, sql } from "../lib/db.js";
import { getDrive } from "../lib/drive-utils.js";
import { requireOwner } from "../lib/session.js";

// 채팅 삭제: SQL chat_index 행 제거(+ Drive 백업 trash). ★부활 방지 핵심 —
// 과거엔 삭제해도 chat_index 가 남아 다음 로그인 때 hybrid-chat-list → loadChatHistoryFromDrive 로
// "0개 메시지" 유령 채팅이 되살아났다. 이제 인덱스를 지워 목록에서 완전히 사라진다.
function clean(v) { return String(v || "").trim(); }
function safeId(v, p = "id") { return (clean(v) || `${p}_0`).replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 100); }

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }
  try {
    const b = req.body || {};
    const auth = requireOwner(req, res, clean(b.userId || b.owner || b.email || req.query?.userId));
    if (!auth) return; // 401/403 이미 응답됨
    const userId = auth.uid;
    const roomId = safeId(b.roomId || b.id || req.query?.roomId, "room");

    const pool = await getPool();
    await pool.request().query(`IF OBJECT_ID('dbo.chat_index','U') IS NULL CREATE TABLE dbo.chat_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,room_id NVARCHAR(100) NOT NULL,title NVARCHAR(255) NULL,project_id NVARCHAR(100) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,message_count INT NOT NULL DEFAULT 0,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`);

    // 삭제 전 Drive 파일 ID 확보(백업 trash 용)
    let driveFileId = null;
    try {
      const found = await pool.request().input("user_id", sql.NVarChar(100), userId).input("room_id", sql.NVarChar(100), roomId)
        .query(`SELECT TOP 1 drive_file_id FROM dbo.chat_index WHERE user_id=@user_id AND room_id=@room_id`);
      driveFileId = found.recordset?.[0]?.drive_file_id || null;
    } catch (e) {}

    await pool.request().input("user_id", sql.NVarChar(100), userId).input("room_id", sql.NVarChar(100), roomId)
      .query(`DELETE FROM dbo.chat_index WHERE user_id=@user_id AND room_id=@room_id`);

    // Drive 백업은 베스트에포트로 휴지통 이동(실패해도 삭제는 성공으로 처리 — 인덱스만 지우면 부활 안 함)
    let driveTrashed = false;
    if (driveFileId) {
      try { await getDrive().files.update({ fileId: driveFileId, requestBody: { trashed: true }, supportsAllDrives: true }); driveTrashed = true; }
      catch (e) {}
    }

    return res.status(200).json({ ok: true, deleted: roomId, driveTrashed });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "채팅 삭제 실패", error: e.message });
  }
}
