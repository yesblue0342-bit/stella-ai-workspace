import { getPool, sql } from "../lib/db.js";
import { saveJsonToDrive, readJsonFromDrive, listJsonFromDrive, ensurePath, listDriveDirectory } from "../lib/drive-utils.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const userId = String(req.query.userId || '').trim();
  const action = String(req.query.action || 'scan').trim();
  if (!userId) return res.status(400).json({ ok: false, message: 'userId 필요' });

  const report = { userId, action, notes: [], chats: [], projects: [] };

  try {
    // ── 1. Azure SQL workspace_state 확인 ──
    const pool = await getPool();
    const ws = await pool.request()
      .input('owner', sql.NVarChar(255), userId)
      .query(`SELECT rooms_json, projects_json, posts_json, updated_at FROM dbo.workspace_state WHERE owner_id=@owner`);

    if (ws.recordset[0]) {
      const row = ws.recordset[0];
      const rooms = JSON.parse(row.rooms_json || '[]');
      const projects = JSON.parse(row.projects_json || '[]');
      const posts = JSON.parse(row.posts_json || '[]');
      report.workspace = { rooms: rooms.length, projects: projects.length, posts: posts.length, updated_at: row.updated_at };
      report.chats = rooms;
      report.projects = projects;
      report.notes = posts;
    } else {
      report.workspace = { rooms: 0, projects: 0, posts: 0, note: 'workspace_state 없음' };
    }

    // ── 2. Azure SQL chat_index 확인 ──
    const ci = await pool.request()
      .input('uid', sql.NVarChar(100), userId)
      .query(`SELECT room_id, title, message_count, drive_file_id, updated_at FROM dbo.chat_index WHERE user_id=@uid ORDER BY updated_at DESC`);
    report.chatIndex = ci.recordset.map(r => ({ id: r.room_id, title: r.title, msgs: r.message_count, driveFileId: r.drive_file_id }));

    // ── 3. Drive 노트 파일 확인 ──
    const driveNotes = [];
    for (const root of ['Board', 'boards']) {
      try {
        const rootFolder = await ensurePath([root]).catch(() => null);
        if (!rootFolder) continue;
        const catList = await listDriveDirectory({ folderId: rootFolder.id, pageSize: 100 });
        const cats = (catList.files || []).filter(f => f.isFolder);
        for (const cat of cats) {
          try {
            const files = await listJsonFromDrive({ folderPath: [root, cat.name], pageSize: 50 });
            for (const f of files.slice(0, 20)) {
              try {
                const r = await readJsonFromDrive({ folderPath: [root, cat.name], fileName: f.name.replace(/\.json$/, '') });
                if (r?.data && !r.data.deleted) {
                  driveNotes.push({ path: `${root}/${cat.name}`, id: r.data.id || r.data.postId || f.name, title: r.data.title, body: (r.data.body || r.data.content || '').slice(0, 100) });
                }
              } catch(e) {}
            }
          } catch(e) {}
        }
      } catch(e) {}
    }
    // users/{userId}/notes
    try {
      const files = await listJsonFromDrive({ folderPath: ['users', userId, 'notes'], pageSize: 100 });
      for (const f of files) {
        try {
          const r = await readJsonFromDrive({ folderPath: ['users', userId, 'notes'], fileName: f.name.replace(/\.json$/, '') });
          if (r?.data && !r.data.deleted) driveNotes.push({ path: `users/${userId}/notes`, id: r.data.id, title: r.data.title, body: (r.data.body || '').slice(0, 100) });
        } catch(e) {}
      }
    } catch(e) {}

    report.driveNotes = driveNotes;
    report.driveNotesCount = driveNotes.length;

    // ── action=restore: workspace_state에서 posts 복원 후 반환 ──
    if (action === 'restore-notes') {
      return res.status(200).json({ ok: true, notes: report.notes, driveNotes, total: report.notes.length + driveNotes.length });
    }

    if (action === 'restore-chats') {
      return res.status(200).json({ ok: true, chats: report.chats, chatIndex: report.chatIndex });
    }

    return res.status(200).json({ ok: true, ...report });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
