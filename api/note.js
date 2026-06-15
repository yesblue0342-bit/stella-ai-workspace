import { saveJsonToDrive, listJsonFromDrive, readJsonFromDrive } from "../lib/drive-utils.js";

export default async function handler(req, res) {
  const action = String(req.query.action || req.body?.action || "list").trim();
  const userId = String(req.query.userId || req.body?.userId || "").trim();
  if (!userId) return res.status(400).json({ ok: false, message: "userId 필요" });

  const folderPath = ["users", userId, "notes"];

  try {
    // ── 목록 조회 ──
    if (action === "list") {
      const files = await listJsonFromDrive({ folderPath, pageSize: 200 });
      const notes = [];
      for (const f of files) {
        try {
          const r = await readJsonFromDrive({ folderPath, fileName: f.name.replace(/\.json$/, "") });
          if (r?.data && !r.data.deleted) notes.push(r.data);
        } catch(e) {}
      }
      notes.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      return res.status(200).json({ ok: true, notes });
    }

    // ── 저장/수정 ──
    if (action === "save") {
      const { id, title, body } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });
      const now = new Date().toISOString();
      const existing = await readJsonFromDrive({ folderPath, fileName: id }).catch(() => null);
      const data = {
        id,
        userId,
        title: String(title || "").trim() || "제목 없음",
        body: String(body || ""),
        createdAt: existing?.data?.createdAt || now,
        updatedAt: now,
        deleted: false
      };
      await saveJsonToDrive({ folderPath, fileName: id, data });
      return res.status(200).json({ ok: true, note: data });
    }

    // ── 삭제 (soft delete - 관리자만 완전 삭제) ──
    if (action === "delete") {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });
      const existing = await readJsonFromDrive({ folderPath, fileName: id }).catch(() => null);
      if (!existing?.data) return res.status(404).json({ ok: false, message: "노트 없음" });
      // soft delete - Drive에서 삭제하지 않고 deleted 플래그만 설정
      await saveJsonToDrive({ folderPath, fileName: id, data: { ...existing.data, deleted: true, deletedAt: new Date().toISOString() } });
      return res.status(200).json({ ok: true, message: "삭제됨" });
    }

    return res.status(400).json({ ok: false, message: "Unknown action: " + action });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
