// POST /api/profile/save — 프로필 저장. userId는 인증 토큰에서 도출(서버측 권한 스코프).
import { saveProfile } from "../../lib/memory-db.mjs";
import { requireOwner } from "../../lib/session.js";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });
  const requested = String((req.body && req.body.userId) || (req.query && req.query.userId) || "").trim();
  const auth = requireOwner(req, res, requested); // 본인 프로필만
  if (!auth) return;
  const r = await saveProfile(auth.uid, req.body || {});
  return res.status(200).json({ ok: !!r });
}
