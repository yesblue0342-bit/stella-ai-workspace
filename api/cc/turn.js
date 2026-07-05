// POST /api/cc/turn — 기존 세션에 후속 프롬프트 전송
import * as MA from "./_maclient.mjs";
import { getSessionRow, saveSession } from "../../lib/cc-db.mjs";
// Drive 참고자료 인식(신규 세션 start.js와 동일 로직) — 후속 턴에서도 Drive 링크/#폴더경로를 인식한다.
import { buildDriveContextForChat } from "../../lib/drive-utils.js";
import { detectDriveIntent } from "../chat.js";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { session, prompt, attachments } = req.body || {};
    if (!session) return res.status(400).json({ error: "session required" });
    const hasAtt = Array.isArray(attachments) && attachments.length > 0;
    if ((!prompt || !String(prompt).trim()) && !hasAtt) return res.status(400).json({ error: "prompt required" });
    let driveNote = "";
    if (prompt && detectDriveIntent(prompt)) {
      try {
        const dc = await buildDriveContextForChat({ message: prompt });
        if (dc && dc.prompt) driveNote = dc.prompt;
      } catch (e) { console.error("[cc/turn] Drive 컨텍스트 로드 실패(무시하고 진행):", e && e.message); }
    }
    await MA.sendUserMessage(session, String(prompt || "") + driveNote, attachments);
    const row = await getSessionRow(session);
    if (row) await saveSession({ id: session, title: row.title, model: row.model, agentId: row.agent_id, environmentId: row.environment_id, status: "running", driveFileId: row.drive_file_id, costUsd: row.cost_usd, budgetUsd: row.budget_usd });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "turn_failed", message: String(e.message || e) });
  }
}
