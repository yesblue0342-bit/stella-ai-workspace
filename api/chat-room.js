import { saveJsonToDrive, readJsonFromDrive, listJsonFromDrive } from "../lib/drive-utils.js";

const clean = (v) => String(v || "").trim();
const makeRoomId = (v) => (clean(v) || "default-room").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 80);

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const action = clean(req.query.action || req.body?.action || "get");

  try {
    // ── 방 메시지 조회 (폴링용) ──
    if (action === "get") {
      const roomId = makeRoomId(req.query.roomId || req.query.room);
      if (!roomId) return res.status(400).json({ ok: false, message: "roomId 필요" });
      const f = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId });
      if (!f?.data) return res.status(200).json({ ok: true, room: null, messages: [] });
      return res.status(200).json({ ok: true, room: f.data, messages: f.data.messages || [] });
    }

    // ── 메시지 전송 (append 방식 - 동시성 안전) ──
    if (action === "send") {
      const body = req.body || {};
      const roomId = makeRoomId(body.roomId || body.room || body.title);
      const title = clean(body.title || body.roomName || roomId);
      const sender = clean(body.sender || body.userName || body.name || "unknown");
      const userId = clean(body.userId || body.email || sender || "unknown");
      const message = clean(body.message || body.text || body.content);
      const fileName = clean(body.fileName || "");
      const fileUrl = clean(body.fileUrl || "");
      const members = Array.isArray(body.members) ? body.members.map(clean).filter(Boolean) : [userId].filter(Boolean);
      if (!message && !fileName) return res.status(400).json({ ok: false, message: "메시지 또는 파일 필요" });

      // 기존 메시지 읽어서 append (덮어쓰기 방지)
      const existing = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      const prevMessages = existing?.data?.messages || [];
      const prevMembers = existing?.data?.members || [];
      // 멤버 병합
      const allMembers = [...new Set([...prevMembers, ...members])];

      const messageItem = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sender, userId, message,
        fileName: fileName || null,
        fileUrl: fileUrl || null,
        createdAt: new Date().toISOString()
      };

      const data = {
        type: "memberChat",
        roomId, title,
        members: allMembers,
        lastMessage: message || ("📎 " + fileName),
        updatedAt: new Date().toISOString(),
        messages: [...prevMessages, messageItem]
      };

      const saved = await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: roomId, data });
      return res.status(200).json({ ok: true, saved, message: messageItem, room: data });
    }

    // ── 내가 속한 방 목록 ──
    if (action === "list") {
      const userId = clean(req.query.userId || req.body?.userId);
      const files = await listJsonFromDrive({ folderPath: ["MemberChat"], pageSize: 100 });
      const rooms = [];
      for (const f of files) {
        try {
          const r = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: f.name.replace(/\.json$/, "") });
          if (!r?.data) continue;
          const d = r.data;
          // userId가 멤버인 방만 (없으면 전체)
          if (userId && Array.isArray(d.members) && d.members.length && !d.members.includes(userId)) continue;
          rooms.push({
            roomId: d.roomId,
            title: d.title,
            members: d.members || [],
            lastMessage: d.lastMessage || "",
            updatedAt: d.updatedAt,
            messageCount: (d.messages || []).length
          });
        } catch (e) {}
      }
      rooms.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      return res.status(200).json({ ok: true, rooms });
    }

    // ── 방 삭제 ──
    if (action === "delete") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const existing = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      if (!existing?.data) return res.status(404).json({ ok: false, message: "방 없음" });
      // soft delete
      await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: roomId, data: { ...existing.data, deleted: true, deletedAt: new Date().toISOString() } });
      return res.status(200).json({ ok: true, message: "방 삭제됨" });
    }

    return res.status(400).json({ ok: false, message: "Unknown action: " + action });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
