import { saveJsonToDrive, readJsonFromDrive, listJsonFromDrive } from "../lib/drive-utils.js";

const clean = (v) => String(v || "").trim();
const makeRoomId = (v) => (clean(v) || "default-room").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 80);

// ── reads/typing 전용 meta 파일 (메시지 파일과 분리해 동시쓰기 클로버링 방지) ──
const metaName = (roomId) => roomId + "__meta";
async function readMeta(roomId) {
  const m = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: metaName(roomId) }).catch(() => null);
  return m?.data || null;
}
async function saveMeta(roomId, meta) {
  await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: metaName(roomId), data: { type: "memberChatMeta", roomId, reads: meta.reads || {}, typing: meta.typing || {}, updatedAt: new Date().toISOString() } });
}
// meta 파일이 아직 없으면 레거시(메시지 파일 내부 reads/typing)에서 1회 이관
async function seedMeta(roomId) {
  const f = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
  return { reads: (f?.data?.reads) || {}, typing: (f?.data?.typing) || {} };
}

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const action = clean(req.query.action || req.body?.action || "get");

  try {
    // ── 방 메시지 조회 (폴링용) ──
    if (action === "get") {
      const roomId = makeRoomId(req.query.roomId || req.query.room);
      if (!roomId) return res.status(400).json({ ok: false, message: "roomId 필요" });
      const f = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId });
      if (!f?.data) return res.status(200).json({ ok: true, room: null, messages: [], reads: {}, typing: {} });
      // reads/typing은 별도 meta 파일에 보관(메시지 파일을 건드리지 않아 동시쓰기로 메시지가 사라지는 레이스 방지).
      // meta가 없으면 레거시(메시지 파일 내부 reads/typing)로 폴백.
      const meta = await readMeta(roomId);
      return res.status(200).json({
        ok: true,
        room: f.data,
        messages: f.data.messages || [],
        reads: (meta && meta.reads) || f.data.reads || {},
        typing: (meta && meta.typing) || f.data.typing || {}
      });
    }

    // ── 읽음 처리 (사용자가 방을 읽은 시각 기록) — meta 파일에만 기록 ──
    if (action === "read") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      if (!roomId || !userId) return res.status(400).json({ ok: false, message: "roomId, userId 필요" });
      const meta = (await readMeta(roomId)) || (await seedMeta(roomId));
      meta.reads = meta.reads || {};
      meta.reads[userId] = Date.now();
      await saveMeta(roomId, meta);
      return res.status(200).json({ ok: true, reads: meta.reads });
    }

    // ── 타이핑 상태 기록 (입력 중 표시용) — meta 파일에만 기록 ──
    if (action === "typing") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      const isTyping = (req.body?.typing ?? req.query.typing) === true || (req.body?.typing ?? req.query.typing) === "true";
      if (!roomId || !userId) return res.status(400).json({ ok: false, message: "roomId, userId 필요" });
      const meta = (await readMeta(roomId)) || (await seedMeta(roomId));
      meta.typing = meta.typing || {};
      if (isTyping) { meta.typing[userId] = Date.now(); }
      else { delete meta.typing[userId]; }
      await saveMeta(roomId, meta);
      return res.status(200).json({ ok: true });
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
        clientId: clean(body.clientId || ""),   // 클라 임시 id 에코 → 프런트가 id 기준으로 정확히 dedup
        sender, userId, message,
        fileName: fileName || null,
        fileUrl: fileUrl || null,
        mimeType: clean(body.mimeType || ''),
        createdAt: new Date().toISOString()
      };

      const data = {
        ...(existing?.data || {}),   // reads/typing 등 기존 필드 보존 (메시지 전송이 메타를 지우지 않게)
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

    // ── 개별 메시지 삭제 (soft delete - 메시지 내용만 제거, 흔적은 남김) ──
    if (action === "delete-message") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const messageId = clean(req.body?.messageId || req.query.messageId);
      const userId = clean(req.body?.userId || req.query.userId);
      if (!roomId || !messageId) return res.status(400).json({ ok: false, message: "roomId, messageId 필요" });

      const existing = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      if (!existing?.data) return res.status(404).json({ ok: false, message: "방 없음" });

      const messages = existing.data.messages || [];
      const idx = messages.findIndex(m => m.id === messageId);
      if (idx === -1) return res.status(404).json({ ok: false, message: "메시지 없음" });

      // 본인 메시지만 삭제 가능 (userId 일치 확인)
      if (userId && messages[idx].userId && messages[idx].userId !== userId) {
        return res.status(403).json({ ok: false, message: "본인 메시지만 삭제할 수 있습니다." });
      }

      // soft delete: 내용은 지우되 "삭제된 메시지입니다" 표시 (카톡 방식)
      messages[idx] = {
        ...messages[idx],
        message: "",
        fileName: null,
        fileUrl: null,
        deleted: true,
        deletedAt: new Date().toISOString()
      };

      await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: roomId, data: { ...existing.data, messages } });
      return res.status(200).json({ ok: true, message: "메시지 삭제됨" });
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
