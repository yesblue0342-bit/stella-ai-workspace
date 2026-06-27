import { saveChatHistory, listChatHistory } from "../../lib/memory-db.mjs";
import { requireOwner } from "../../lib/session.js";
export default async function handler(req, res) {
  const requested = String((req.body && req.body.userId) || (req.query && req.query.userId) || "").trim();
  // 서버측 권한 스코프: 본인 채팅 히스토리만.
  const auth = requireOwner(req, res, requested);
  if (!auth) return;
  const userId = auth.uid;
  if (req.method === "POST") { const r = await saveChatHistory(userId, req.body || {}); return res.status(r.ok?200:400).json(r); }
  const chats = await listChatHistory(userId, String((req.query && req.query.q) || "").trim(), (req.query && req.query.limit) || 30);
  return res.status(200).json({ ok:true, chats });
}
