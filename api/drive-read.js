import { readDriveTarget, resolveDrivePath, normalizeDriveError } from "../lib/drive-utils.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb"
    }
  },
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const body = req.method === "POST" ? (req.body || {}) : {};
    const query = req.query || {};

    const fileId = String(body.fileId || query.fileId || "").trim();
    const folderId = String(body.folderId || query.folderId || "").trim();
    const path = String(body.path || query.path || "").trim();
    const recursive = String(body.recursive ?? query.recursive ?? "false") === "true";
    const maxFiles = Math.min(Math.max(Number(body.maxFiles || query.maxFiles || 20), 1), 50);

    let target = { fileId, folderId };
    if (path && !fileId && !folderId) {
      target = await resolveDrivePath(path);
    }

    if (!target.fileId && !target.folderId) {
      return res.status(400).json({
        ok: false,
        message: "fileId, folderId 또는 path 중 하나가 필요합니다."
      });
    }

    const data = await readDriveTarget({ ...target, recursive, maxFiles });

    return res.status(200).json({
      ok: true,
      path: path || "",
      ...data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Drive read failed",
      error: normalizeDriveError(error)
    });
  }
}
