import { searchMemory } from "../../lib/memory-db.mjs";
export default async function handler(req, res) {
  const userId = String((req.body && req.body.userId) || (req.query && req.query.userId) || "anonymous").trim();
  const memories = await searchMemory(userId, String((req.query && req.query.q) || "").trim(), (req.query && req.query.limit) || 50);
  return res.status(200).json({ ok:true, memories });
}
