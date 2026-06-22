import { saveJsonToDrive, readJsonFromDrive, listJsonFromDrive } from "../lib/drive-utils.js";
import { applyLeave, shouldListRoom } from "../lib/room-membership.js";

const clean = (v) => String(v || "").trim();
const makeRoomId = (v) => (clean(v) || "default-room").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 80);
// STAGE 4: 멤버 검증 — members 명단이 비면(레거시 방) 잠금 방지로 통과. 코드방은 코드 아는 누구나 허용.
const isMember = (data, userId) => {
  const members = Array.isArray(data?.members) ? data.members.map(String) : [];
  if (!members.length) return true;
  return members.includes(String(userId || ""));
};
const isCodeRoom = (roomId) => String(roomId || "").startsWith("room_code_");

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
      const serverTime = Date.now();
      const f = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId });
      if (!f?.data) return res.status(200).json({ ok: true, room: null, messages: [], reads: {}, typing: {}, serverTime, lastMessageAt: 0, hasMore: false });
      // STAGE 4 보안: 멤버가 아니면 열람 차단(임의 roomId 조회 방지). 코드방/레거시(멤버없음)는 허용.
      const requester = clean(req.query.userId || req.body?.userId);
      if (requester && !isCodeRoom(roomId) && !isMember(f.data, requester)) {
        return res.status(403).json({ ok: false, message: "이 방의 멤버가 아닙니다." });
      }
      // reads/typing은 별도 meta 파일에 보관(메시지 파일을 건드리지 않아 동시쓰기로 메시지가 사라지는 레이스 방지).
      // meta가 없으면 레거시(메시지 파일 내부 reads/typing)로 폴백.
      const meta = await readMeta(roomId);
      // STAGE 1: 증분 동기화 — since(ms epoch) 있으면 그 이후 메시지만, limit 있으면 최근 limit개만.
      //          since/limit 모두 없으면 전체 반환(하위호환). since 우선(증분 폴링 경로).
      const allMsgs = Array.isArray(f.data.messages) ? f.data.messages : [];
      const msgTime = (m) => { const t = new Date(m && m.createdAt).getTime(); return isNaN(t) ? 0 : t; };
      const since = Number(req.query.since || 0) || 0;
      const limit = Number(req.query.limit || 0) || 0;
      let out = allMsgs;
      let hasMore = false;
      if (since > 0) {
        out = allMsgs.filter((m) => msgTime(m) > since);          // 새 메시지만
      } else if (limit > 0 && allMsgs.length > limit) {
        out = allMsgs.slice(-limit);                              // 최근 limit개
        hasMore = true;                                           // 위로 더 불러올 과거 메시지 있음
      }
      const lastMsg = allMsgs[allMsgs.length - 1];
      return res.status(200).json({
        ok: true,
        room: f.data,
        messages: out,
        reads: (meta && meta.reads) || f.data.reads || {},
        typing: (meta && meta.typing) || f.data.typing || {},
        serverTime,
        lastMessageAt: lastMsg ? msgTime(lastMsg) : 0,
        hasMore,
        total: allMsgs.length
      });
    }

    // ── 읽음 처리 (사용자가 방을 읽은 시각 기록) — meta 파일에만 기록 ──
    if (action === "read") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      if (!roomId || !userId) return res.status(400).json({ ok: false, message: "roomId, userId 필요" });
      const meta = (await readMeta(roomId)) || (await seedMeta(roomId));
      meta.reads = meta.reads || {};
      // STAGE 3: 읽음 시각은 단조 증가만 (read-modify-write 레이스로 과거 값이 와도 되돌리지 않음)
      meta.reads[userId] = Math.max(Number(meta.reads[userId]) || 0, Date.now());
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
      // STAGE 4 보안: 기존 방 + 멤버명단 있음 + 발신자 비멤버 + 코드방 아님 → 임의 전송 차단.
      //   (새 방 생성/코드방 입장/기존 멤버는 통과. 비멤버 자동합류 금지)
      if (existing?.data && !isCodeRoom(roomId)) {
        const pm = prevMembers.map(String);
        if (pm.length && !pm.includes(String(userId))) {
          return res.status(403).json({ ok: false, message: "이 방의 멤버가 아니어서 전송할 수 없습니다." });
        }
      }
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
      // 전송 응답을 먼저 만든다(푸시는 절대 응답을 지연/차단하지 않음).
      const lastAt = new Date(messageItem.createdAt).getTime();
      const payload = { ok: true, saved, message: messageItem, lastMessageAt: isNaN(lastAt) ? 0 : lastAt, messageCount: data.messages.length };
      // 백그라운드 Web Push: VAPID 키가 있을 때만 모듈 로드 + 발송(fire-and-forget). 키 없으면 import조차 안 함 → 전송 경로 영향 0.
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        import("../lib/push-send.js")
          .then(({ sendRoomPush }) => sendRoomPush({ members: allMembers, senderId: userId, title, body: data.lastMessage, roomId }))
          .catch(() => {});
      }
      return res.status(200).json(payload);
    }

    // ── 멤버 초대/합류 (메시지 없이 members 갱신, 재초대 시 left 해제) ── STAGE 4
    //   confirmInvite/joinByCode 가 호출 → 초대된 사용자가 list/get 에서 방을 실제로 보게 됨.
    if (action === "invite" || action === "join") {
      const body = req.body || {};
      const roomId = makeRoomId(body.roomId || body.room);
      const title = clean(body.title || body.roomName || "");
      const add = (Array.isArray(body.members) ? body.members : [body.userId]).map(clean).filter(Boolean);
      if (!roomId || !add.length) return res.status(400).json({ ok: false, message: "roomId, members 필요" });
      const existing = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      const base = existing?.data || { type: "memberChat", roomId, title: title || roomId, members: [], messages: [] };
      const prevMembers = Array.isArray(base.members) ? base.members.map(String) : [];
      const newMembers = [...new Set([...prevMembers, ...add])];
      // 재초대: 나간 기록(left)에서 복귀
      const prevLeft = Array.isArray(base.left) ? base.left.map(String) : [];
      const newLeft = prevLeft.filter((l) => !add.includes(l));
      const data = {
        ...base,
        type: "memberChat",
        roomId,
        title: title || base.title || roomId,
        members: newMembers,
        left: newLeft,
        deleted: newMembers.length ? false : base.deleted,   // 멤버 생기면 tombstone 해제
        updatedAt: new Date().toISOString(),
        messages: Array.isArray(base.messages) ? base.messages : []
      };
      await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: roomId, data });
      return res.status(200).json({ ok: true, members: newMembers, left: newLeft });
    }

    // ── 이모지 반응 토글 (append/remove 방식) ── STAGE 8
    if (action === "react") {
      const body = req.body || {};
      const roomId = makeRoomId(body.roomId);
      const messageId = clean(body.messageId);
      const userId = clean(body.userId);
      const emoji = clean(body.emoji).slice(0, 8);
      if (!roomId || !messageId || !userId || !emoji) return res.status(400).json({ ok: false, message: "roomId, messageId, userId, emoji 필요" });
      const existing = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      if (!existing?.data) return res.status(404).json({ ok: false, message: "방 없음" });
      if (!isCodeRoom(roomId) && !isMember(existing.data, userId)) return res.status(403).json({ ok: false, message: "이 방의 멤버가 아닙니다." });
      const messages = existing.data.messages || [];
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return res.status(404).json({ ok: false, message: "메시지 없음" });
      const reactions = { ...(messages[idx].reactions || {}) };
      const users = Array.isArray(reactions[emoji]) ? reactions[emoji].map(String) : [];
      reactions[emoji] = users.includes(userId) ? users.filter((u) => u !== userId) : [...users, userId];  // 토글
      if (reactions[emoji].length === 0) delete reactions[emoji];
      messages[idx] = { ...messages[idx], reactions };
      await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: roomId, data: { ...existing.data, messages } });
      return res.status(200).json({ ok: true, reactions });
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
          // C3: 나간 사람/soft-deleted 방 제외 (재동기화로 부활 방지)
          if (!shouldListRoom(d, userId)) continue;
          const msgs = d.messages || [];
          const lastMsg = msgs[msgs.length - 1];
          // 마지막 메시지 시각(ms) — since 기반 전역 알림 감지용. createdAt/at/time 폴백.
          const lastAt = lastMsg ? (function(m){ const t = new Date(m.createdAt || m.at || m.time || 0).getTime(); return isNaN(t) ? (Number(m.at) || 0) : t; })(lastMsg) : 0;
          rooms.push({
            roomId: d.roomId,
            title: d.title,
            members: d.members || [],
            lastMessage: d.lastMessage || "",
            updatedAt: d.updatedAt,
            messageCount: msgs.length,
            lastMessageAt: lastAt,
            lastMessageFrom: lastMsg ? String(lastMsg.userId || lastMsg.sender || "") : ""
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
      const userId = clean(req.body?.userId || req.query.userId);
      const existing = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      if (!existing?.data) return res.status(404).json({ ok: false, message: "방 없음" });
      // STAGE 4 보안: 멤버만 삭제 가능 (레거시 멤버없음 방은 통과)
      if (userId && !isMember(existing.data, userId)) {
        return res.status(403).json({ ok: false, message: "이 방의 멤버만 삭제할 수 있습니다." });
      }
      // soft delete
      await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: roomId, data: { ...existing.data, deleted: true, deletedAt: new Date().toISOString() } });
      return res.status(200).json({ ok: true, message: "방 삭제됨" });
    }

    // ── 방 나가기 (C3: 멤버에서 제외 + left 기록, 영구 반영) ──
    if (action === "leave") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      if (!roomId || !userId) return res.status(400).json({ ok: false, message: "roomId, userId 필요" });
      const existing = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      if (!existing?.data) return res.status(200).json({ ok: true, message: "이미 없음" }); // 멱등
      const patched = applyLeave(existing.data, userId);
      await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: roomId, data: patched });
      return res.status(200).json({ ok: true, members: patched.members, left: patched.left, deleted: !!patched.deleted });
    }

    return res.status(400).json({ ok: false, message: "Unknown action: " + action });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
