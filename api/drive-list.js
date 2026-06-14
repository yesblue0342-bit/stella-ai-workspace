import { listDriveDirectory } from "../lib/drive-utils.js";

export default async function handler(req, res) {
  try {
    const folderId = String(req.query.folderId || req.query.id || "").trim();
    const limit = Math.min(Number(req.query.limit || 100), 200);
    const pageSize = Number.isFinite(limit) ? limit : 100;

    // folderId 없으면 scope="root" → 내 드라이브 루트 탐색
    const scope = folderId ? undefined : "root";

    const data = await listDriveDirectory({ scope, folderId: folderId || undefined, pageSize });
    return res.status(200).json({ ok: true, folder: data.folder, files: data.files });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Drive list failed", error: error.message });
  }
}
