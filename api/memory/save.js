import { saveMemory } from "../../lib/memory-db.mjs";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });
  const userId = String((req.body && req.body.userId) || (req.query && req.query.userId) || "anonymous").trim();
  const b = req.body || {};
  const r = await saveMemory(userId, { memory_text:b.memory_text, category:b.category, app_scope:b.app_scope, source:b.source });
  return res.status(r.ok ? 200 : 400).json(r);
}
