import { updateMemory } from "../../lib/memory-db.mjs";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });
  const userId = String((req.body && req.body.userId) || (req.query && req.query.userId) || "anonymous").trim();
  const b = req.body || {};
  const r = await updateMemory(userId, b.memory_id, { memory_text:b.memory_text, category:b.category, is_active:b.is_active });
  return res.status(r.ok ? 200 : (r.error==="memory_id required"?400:404)).json(r);
}
