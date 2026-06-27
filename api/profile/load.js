import { loadProfile } from "../../lib/memory-db.mjs";
import { requireOwner } from "../../lib/session.js";
export default async function handler(req, res) {
  const requested = String((req.body && req.body.userId) || (req.query && req.query.userId) || "").trim();
  const auth = requireOwner(req, res, requested); // 본인 프로필만
  if (!auth) return;
  const profile = await loadProfile(auth.uid);
  return res.status(200).json({ ok:true, profile });
}
