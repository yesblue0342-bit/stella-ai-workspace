import { saveJsonToDrive } from "./drive-utils.js";

function clean(value) {
  return String(value || "").trim();
}

function makeRoomId(value) {
  const raw = clean(value) || "default-room";
  return raw.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 80);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const roomId = makeRoomId(body.roomId || body.room || body.title);
    const title = clean(body.title || body.roomName || roomId);
    const sender = clean(body.sender || body.userName || body.name || "unknown");
    const userId = clean(body.userId || body.email || sender || "unknown");
    const message = clean(body.message || body.text || body.content);
    const members = Array.isArray(body.members) ? body.members.map(clean).filter(Boolean) : [userId].filter(Boolean);

    if (!message) {
      return res.status(400).json({ ok: false, message: "메시지를 입력하세요." });
    }

    const messageItem = {
      id: `msg_${Date.now()}`,
      sender,
      userId,
      message,
      createdAt: new Date().toISOString()
    };

    const data = {
      type: "memberChat",
      roomId,
      title,
      members,
      lastMessage: message,
      updatedAt: new Date().toISOString(),
      messages: Array.isArray(body.messages) ? [...body.messages, messageItem] : [messageItem]
    };

    const saved = await saveJsonToDrive({
      folderPath: ["MemberChat"],
      fileName: `${roomId}.json`,
      data
    });

    return res.status(200).json({ ok: true, message: "회원 채팅 저장 완료", saved, room: data });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "회원 채팅 저장 실패", error: error.message });
  }
}
