// POST /api/cc/turn — 기존 세션에 후속 프롬프트 전송
import * as MA from "./_maclient.mjs";
import { getSessionRow, saveSession } from "../../lib/cc-db.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { session, prompt } = req.body || {};
    if (!session) return res.status(400).json({ error: "session required" });
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "prompt required" });
    await MA.sendUserMessage(session, prompt);
    const row = await getSessionRow(session);
    if (row) await saveSession({ id: session, title: row.title, model: row.model, agentId: row.agent_id, environmentId: row.environment_id, status: "running", driveFileId: row.drive_file_id, costUsd: row.cost_usd, budgetUsd: row.budget_usd });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "turn_failed", message: String(e.message || e) });
  }
}
