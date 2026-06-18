// GET /api/cc/events?session=&after=<seq> — after 이후 새 정규화 이벤트 + 예산 체크
// 서버리스 60초 안에 끝내고 브라우저가 반복 폴링한다(스트림 장기 점유 금지).
import * as MA from "./_maclient.mjs";
import { getSessionRow, saveSession } from "../../lib/cc-db.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const session = String(req.query.session || "");
    const after = parseInt(req.query.after, 10) || 0;
    if (!session) return res.status(400).json({ error: "session required" });

    const raw = await MA.listEvents(session);
    const norm = MA.normalizeEvents(raw);
    const fresh = norm.filter((e) => e.seq > after);
    const cursor = norm.length ? norm[norm.length - 1].seq : after;

    // 예산 가드레일: 세션 usage로 비용 추정 → 초과 시 interrupt
    let cost = null, budget = null, overBudget = false;
    const row = await getSessionRow(session);
    if (row) budget = row.budget_usd;
    try {
      const s = await MA.getSession(session);
      cost = MA.estimateCostUsd(row ? row.model : "claude-sonnet-4-6", s.usage || {});
      if (budget && cost >= budget) {
        overBudget = true;
        try { await MA.interruptSession(session); } catch {}
        fresh.push({ seq: cursor + 1, kind: "status", status: "error", error: `예산 한도 초과(약 $${cost.toFixed(3)} / $${Number(budget).toFixed(2)}) — 세션을 중단했습니다.` });
      }
      if (row) {
        const termFresh = fresh.find((e) => e.kind === "status" && (e.status === "idle" || e.status === "error"));
        const newStatus = overBudget ? "error" : (termFresh ? termFresh.status : row.status);
        await saveSession({ id: session, title: row.title, model: row.model, agentId: row.agent_id, environmentId: row.environment_id, status: newStatus, driveFileId: row.drive_file_id, costUsd: cost, budgetUsd: row.budget_usd });
      }
    } catch { /* usage 조회 실패해도 이벤트는 반환 */ }

    return res.status(200).json({ events: fresh, cursor, cost, budget, overBudget });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "events_failed", message: String(e.message || e) });
  }
}
