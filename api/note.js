import { saveJsonToDrive, listJsonFromDrive, readJsonFromDrive, listDriveDirectory, ensurePath } from "../lib/drive-utils.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const action = String(req.query.action || req.body?.action || "list").trim();
  const userId = String(req.query.userId || req.body?.userId || "").trim();
  if (!userId) return res.status(400).json({ ok: false, message: "userId 필요" });

  const notesPath = ["users", userId, "notes"];

  try {
    // ── 목록 조회 (users/{userId}/notes + boards/{userId}/* 통합) ──
    if (action === "list") {
      const noteMap = new Map(); // id 기준 중복 제거

      // 1) 표준 경로: users/{userId}/notes/
      try {
        const files = await listJsonFromDrive({ folderPath: notesPath, pageSize: 200 });
        for (const f of files) {
          try {
            const r = await readJsonFromDrive({ folderPath: notesPath, fileName: f.name.replace(/\.json$/, "") });
            if (r?.data && !r.data.deleted) {
              const id = r.data.id || f.name.replace(/\.json$/, "");
              noteMap.set(id, { ...r.data, id });
            }
          } catch(e) {}
        }
      } catch(e) {}

      // 2) 레거시 경로: boards/{userId}/{카테고리}/ 하위 모든 게시글
      try {
        const boardRoot = await ensurePath(["boards", userId]);
        const catList = await listDriveDirectory({ folderId: boardRoot.id, pageSize: 100 });
        const categories = (catList.files || []).filter(f => f.isFolder).map(f => f.name);
        for (const cat of categories) {
          try {
            const files = await listJsonFromDrive({ folderPath: ["boards", userId, cat], pageSize: 100 });
            for (const f of files) {
              try {
                const r = await readJsonFromDrive({ folderPath: ["boards", userId, cat], fileName: f.name.replace(/\.json$/, "") });
                if (r?.data && !r.data.deleted) {
                  const id = r.data.postId || r.data.id || f.name.replace(/\.json$/, "");
                  // 표준 경로에 이미 있으면 덮어쓰지 않음
                  if (!noteMap.has(id)) {
                    noteMap.set(id, {
                      id,
                      title: r.data.title || "(제목없음)",
                      body: r.data.content || r.data.body || "",
                      category: r.data.category || cat,
                      createdAt: r.data.createdAt,
                      updatedAt: r.data.updatedAt || r.data.createdAt,
                      deleted: false
                    });
                  }
                }
              } catch(e) {}
            }
          } catch(e) {}
        }
      } catch(e) {}

      const notes = Array.from(noteMap.values());
      notes.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      return res.status(200).json({ ok: true, notes, total: notes.length });
    }

    // ── 저장/수정 ──
    if (action === "save") {
      const { id, title, body } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });
      const now = new Date().toISOString();
      const existing = await readJsonFromDrive({ folderPath: notesPath, fileName: id }).catch(() => null);
      const data = {
        id,
        userId,
        title: String(title || "").trim() || "제목 없음",
        body: String(body || ""),
        category: "노트",
        createdAt: existing?.data?.createdAt || now,
        updatedAt: now,
        deleted: false
      };
      await saveJsonToDrive({ folderPath: notesPath, fileName: id, data });
      return res.status(200).json({ ok: true, note: data });
    }

    // ── 삭제 (soft delete - Drive 파일 유지, deleted 플래그만) ──
    if (action === "delete") {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });
      const existing = await readJsonFromDrive({ folderPath: notesPath, fileName: id }).catch(() => null);
      if (existing?.data) {
        await saveJsonToDrive({ folderPath: notesPath, fileName: id, data: { ...existing.data, deleted: true, deletedAt: new Date().toISOString() } });
      }
      // 레거시 boards 경로에도 있으면 거기도 soft delete
      try {
        const boardRoot = await ensurePath(["boards", userId]);
        const catList = await listDriveDirectory({ folderId: boardRoot.id, pageSize: 100 });
        const categories = (catList.files || []).filter(f => f.isFolder).map(f => f.name);
        for (const cat of categories) {
          const ex = await readJsonFromDrive({ folderPath: ["boards", userId, cat], fileName: id }).catch(() => null);
          if (ex?.data) {
            await saveJsonToDrive({ folderPath: ["boards", userId, cat], fileName: id, data: { ...ex.data, deleted: true, deletedAt: new Date().toISOString() } });
          }
        }
      } catch(e) {}
      return res.status(200).json({ ok: true, message: "삭제됨" });
    }

    return res.status(400).json({ ok: false, message: "Unknown action: " + action });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
