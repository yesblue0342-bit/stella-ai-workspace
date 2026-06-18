import { saveChatHistory, listChatHistory } from "../../lib/memory-db.mjs";
export default async function handler(req, res) {
  const userId = String((req.body && req.body.userId) || (req.query && req.query.userId) || "anonymous").trim();
  if (req.method === "POST") { const r = await saveChatHistory(userId, req.body || {}); return res.status(r.ok?200:400).json(r); }
  const chats = await listChatHistory(userId, String((req.query && req.query.q) || "").trim(), (req.query && req.query.limit) || 30);
  return res.status(200).json({ ok:true, chats });
}
