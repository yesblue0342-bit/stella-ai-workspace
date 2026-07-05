// GET /api/codex/chats — 대화 목록(사이드바용, 서버 DB). cc의 api/cc/sessions.js와 동일 패턴.
import { listCodexChats } from "../../lib/codex-db.mjs";
export default async function handler(req, res) {
  try {
    const items = await listCodexChats();
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res.status(200).json({ ok: false, items: [], message: String(e.message || e) });
  }
}
