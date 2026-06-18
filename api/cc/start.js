// POST /api/cc/start — 에이전트/환경 재사용 + 세션 생성 + 첫 턴 전송
import { isValidModel, DEFAULT_MODEL } from "../../lib/agentcore.mjs";
import * as MA from "./_maclient.mjs";
import { getMeta, setMeta, saveSession } from "../../lib/cc-db.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { model: reqModel, prompt, title, budgetUsd, omc } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "prompt required" });
    const model = isValidModel(reqModel) ? reqModel : DEFAULT_MODEL; // 화이트리스트 검증
    const budget = Math.max(0.01, Math.min(Number(budgetUsd) || 20, 50)); // 기본 $20, 상한 $50
    const useOmc = !!omc;

    const environmentId = await MA.getOrCreateEnvironment(getMeta, setMeta);
    const agentId = await MA.getOrCreateAgent(model, useOmc, getMeta, setMeta);
    const rawTitle = (title && String(title).trim()) || String(prompt).trim();
    const title2 = rawTitle.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Stella Agent Code";
    const sessionId = await MA.createSession(agentId, environmentId, title2);
    await MA.sendUserMessage(sessionId, prompt);

    await saveSession({ id: sessionId, title: title2, model, agentId, environmentId, status: "running", budgetUsd: budget, costUsd: 0 });
    return res.status(200).json({ sessionId, agentId, environmentId, model, budgetUsd: budget, title: title2, omc: useOmc });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "start_failed", message: String(e.message || e) });
  }
}
