// GET/POST /api/codex/chat — 대화 저장/불러오기(서버 DB, 기기·브라우저 간 공유).
// GET  ?id=xxx           → 저장된 전체 대화(messages 포함) 반환.
// POST {id,title,model,messages} → upsert.
// OpenAI Chat Completions는 세션을 서버에 보관하지 않아(무상태), cc처럼 제공자 쪽 상태를
// 재조회하는 방식이 불가능 — 전체 messages 배열을 그대로 저장·복원한다.
import { getCodexChat, saveCodexChat } from "../../lib/codex-db.mjs";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const id = String(req.query?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, message: "id required" });
    const chat = await getCodexChat(id);
    if (!chat) return res.status(404).json({ ok: false, message: "대화를 찾을 수 없습니다" });
    return res.status(200).json({ ok: true, chat });
  }
  if (req.method === "POST") {
    const { id, title, model, messages } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, message: "id required" });
    const saved = await saveCodexChat({ id, title, model, messages });
    return res.status(200).json({ ok: saved });
  }
  return res.status(405).json({ ok: false, message: "GET or POST only" });
}
