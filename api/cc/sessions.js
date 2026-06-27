// GET /api/cc/sessions — 세션 목록(재개용). Azure cc_sessions에서 로드.
import { listSessions } from "../../lib/cc-db.mjs";
export default async function handler(req, res) {
  try {
    const items = await listSessions();
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res.status(200).json({ ok: false, items: [], message: String(e.message || e) });
  }
}
