// POST /api/cc/save — 세션 트랜스크립트(markdown)를 Drive stellaclaudecode/ 에 저장 + cc_sessions 갱신
import { getDrive, ensurePath } from "../../lib/drive-utils.js";
import { getSessionRow, saveSession } from "../../lib/cc-db.mjs";
function cleanName(s) {
  return String(s || "transcript").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { session, markdown, title, status, costUsd } = req.body || {};
    if (!session) return res.status(400).json({ error: "session required" });
    if (!markdown || !String(markdown).trim()) return res.status(400).json({ error: "markdown required" });

    let driveFileId = null, driveLink = null, driveError = null;
    try {
      const drive = getDrive();
      const folder = await ensurePath(["stellaclaudecode"]);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const name = cleanName(`${stamp}_${title || session}.md`);
      const created = await drive.files.create({
        requestBody: { name, mimeType: "text/markdown", parents: [folder.id] },
        media: { mimeType: "text/markdown", body: String(markdown) },
        fields: "id,name,webViewLink",
      });
      driveFileId = created.data.id;
      driveLink = created.data.webViewLink;
    } catch (e) { driveError = String(e.message || e); }

    const row = await getSessionRow(session);
    if (row) {
      await saveSession({
        id: session, title: row.title, model: row.model, agentId: row.agent_id, environmentId: row.environment_id,
        status: status || row.status, driveFileId: driveFileId || row.drive_file_id, costUsd: costUsd != null ? costUsd : row.cost_usd, budgetUsd: row.budget_usd,
      });
    }
    return res.status(200).json({ ok: true, driveFileId, driveLink, driveError });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "save_failed", message: String(e.message || e) });
  }
}
