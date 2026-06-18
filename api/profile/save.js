// POST /api/profile/save — 프로필 저장(Azure). userId는 기존 패턴대로 body에서.
import { saveProfile } from "../../lib/memory-db.mjs";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });
  const userId = String((req.body && req.body.userId) || (req.query && req.query.userId) || "anonymous").trim();
  const r = await saveProfile(userId, req.body || {});
  return res.status(r ? 200 : 200).json({ ok: !!r });
}
