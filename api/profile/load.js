import { loadProfile } from "../../lib/memory-db.mjs";
export default async function handler(req, res) {
  const userId = String((req.body && req.body.userId) || (req.query && req.query.userId) || "anonymous").trim();
  const profile = await loadProfile(userId);
  return res.status(200).json({ ok:true, profile });
}
