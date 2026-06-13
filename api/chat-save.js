import { saveJsonToDrive } from "./drive-utils.js";

function clean(value = "") {
  return String(value || "").trim();
}

function safeId(value = "") {
  const raw = clean(value) || `chat_${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 100);
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && item.content)
    .map((item, index) => ({
      id: clean(item.id) || `msg_${Date.now()}_${index}`,
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || ""),
      createdAt: clean(item.createdAt) || new Date().toISOString()
    }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const userId = clean(body.userId || body.email || body.user || "guest");
    const chatId = safeId(body.chatId || body.id || body.title);
    const title = clean(body.title || body.name || "Stella GPT Chat");
    const messages = normalizeMessages(body.messages || body.history);

    if (messages.length === 0) {
      return res.status(400).json({ ok: false, message: "저장할 채팅 메시지가 없습니다." });
    }

    const data = {
      type: "stellaGptChat",
      userId,
      chatId,
      title,
      model: clean(body.model || ""),
      messages,
      messageCount: messages.length,
      updatedAt: new Date().toISOString()
    };

    const saved = await saveJsonToDrive({
      folderPath: ["ChatHistory", userId],
      fileName: `${chatId}.json`,
      data
    });

    return res.status(200).json({ ok: true, message: "Stella GPT 채팅 저장 완료", saved, chat: data });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Stella GPT 채팅 저장 실패", error: error.message });
  }
}
