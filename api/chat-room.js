/*
 * Stella Talk 채팅방 API — lib/chat-store.js(인메모리 캐시 + 방별 직렬화 큐) 기반.
 *
 * 성능 계약(품질 사고 재발 방지):
 *  - get/list/typing/read 는 캐시 응답(정상 상태에서 Drive 호출 0회) — 폴링이 Drive 쿼터를 태우지 않는다.
 *  - send/invite/react/delete 계열은 방별 잠금 안에서 read-modify-write → 동시 전송 메시지 유실 차단.
 *  - send 는 clientId 멱등: 같은 clientId 재전송(클라 재시도)이 와도 메시지가 중복 저장되지 않는다.
 *  - 읽기 '오류'(쿼터/네트워크)를 '방 없음'으로 오인해 messages:[] 로 덮어쓰면 대화 전체가
 *    영구 소실된다 → 오류는 503 으로 중단(기존 계약 유지).
 */
import { applyLeave, shouldListRoom } from "../lib/room-membership.js";
import {
  loadRoom, mutateRoom, appendMessage, emitRoomChanged,
  getReads, markRead, setTyping, getTyping,
  listRoomSummaries, countUnread
} from "../lib/chat-store.js";
import { sendChatPush } from "../lib/push-send.js";

const clean = (v) => String(v || "").trim();
const makeRoomId = (v) => (clean(v) || "default-room").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 80);
// STAGE 4: 멤버 검증 — members 명단이 비면(레거시 방) 잠금 방지로 통과. 코드방은 코드 아는 누구나 허용.
const isMember = (data, userId) => {
  const members = Array.isArray(data?.members) ? data.members.map(String) : [];
  if (!members.length) return true;
  return members.includes(String(userId || ""));
};
const isCodeRoom = (roomId) => String(roomId || "").startsWith("room_code_");
const msgTime = (m) => { const t = new Date(m && m.createdAt).getTime(); return isNaN(t) ? 0 : t; };

// mutator 안에서 HTTP 상태를 갖고 중단할 때 사용
function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

export default async function handler(req, res) {
  const action = clean(req.query.action || req.body?.action || "get");

  try {
    // ── 방 메시지 조회 (폴링용, 캐시 응답) ──
    if (action === "get") {
      const roomId = makeRoomId(req.query.roomId || req.query.room);
      if (!roomId) return res.status(400).json({ ok: false, message: "roomId 필요" });
      const serverTime = Date.now();
      const f = await loadRoom(roomId);
      if (!f) return res.status(200).json({ ok: true, room: null, messages: [], reads: {}, typing: {}, serverTime, lastMessageAt: 0, hasMore: false });
      // STAGE 4 보안: 멤버가 아니면 열람 차단(임의 roomId 조회 방지). 코드방/레거시(멤버없음)는 허용.
      const requester = clean(req.query.userId || req.body?.userId);
      if (requester && !isCodeRoom(roomId) && !isMember(f, requester)) {
        return res.status(403).json({ ok: false, message: "이 방의 멤버가 아닙니다." });
      }
      const reads = await getReads(roomId);
      const typingNow = getTyping(roomId);
      // STAGE 1: 증분 동기화 — since(ms epoch) 있으면 그 이후 메시지만, limit 있으면 최근 limit개만.
      const allMsgs = Array.isArray(f.messages) ? f.messages : [];
      const since = Number(req.query.since || 0) || 0;
      const limit = Number(req.query.limit || 0) || 0;
      let out = allMsgs;
      let hasMore = false;
      if (since > 0) {
        out = allMsgs.filter((m) => msgTime(m) > since);          // 새 메시지만
      } else if (limit > 0 && allMsgs.length > limit) {
        out = allMsgs.slice(-limit);                              // 최근 limit개
        hasMore = true;
      }
      const lastMsg = allMsgs[allMsgs.length - 1];
      // 증분 폴링(since>0)에서는 room.messages 를 빼서 페이로드를 줄인다
      // (talk.html 은 room.members 만 사용. 전체 메시지는 첫 진입/full 동기화에서만 필요).
      const room = since > 0 ? { ...f, messages: undefined } : f;
      return res.status(200).json({
        ok: true,
        room,
        messages: out,
        reads: reads || f.reads || {},
        typing: typingNow,
        serverTime,
        lastMessageAt: lastMsg ? msgTime(lastMsg) : 0,
        hasMore,
        total: allMsgs.length
      });
    }

    // ── 읽음 처리 — 메모리 즉시 + write-behind(캐시 응답) ──
    if (action === "read") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      if (!roomId || !userId) return res.status(400).json({ ok: false, message: "roomId, userId 필요" });
      const reads = await markRead(roomId, userId); // 단조 증가(과거로 되돌리지 않음)
      return res.status(200).json({ ok: true, reads });
    }

    // ── 타이핑 상태 — 메모리 전용(Drive 쓰기 0) ──
    if (action === "typing") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      const isTyping = (req.body?.typing ?? req.query.typing) === true || (req.body?.typing ?? req.query.typing) === "true";
      if (!roomId || !userId) return res.status(400).json({ ok: false, message: "roomId, userId 필요" });
      setTyping(roomId, userId, isTyping);
      return res.status(200).json({ ok: true });
    }

    // ── 메시지 전송 (방별 잠금 + clientId 멱등) ──
    if (action === "send") {
      const body = req.body || {};
      const roomId = makeRoomId(body.roomId || body.room || body.title);
      const title = clean(body.title || body.roomName || roomId);
      const sender = clean(body.sender || body.userName || body.name || "unknown");
      const userId = clean(body.userId || body.email || sender || "unknown");
      const message = clean(body.message || body.text || body.content);
      const fileName = clean(body.fileName || "");
      const fileUrl = clean(body.fileUrl || "");
      const clientId = clean(body.clientId || "");
      const mimeType = clean(body.mimeType || '');
      const members = Array.isArray(body.members) ? body.members.map(clean).filter(Boolean) : [userId].filter(Boolean);
      if (!message && !fileName) return res.status(400).json({ ok: false, message: "메시지 또는 파일 필요" });

      // ★메시지 누락 방지: createdAt/id 를 반드시 방 잠금 '안'에서 찍는다.
      //   잠금 밖에서 찍으면(핸들러 진입 시각), 큐 대기/콜드캐시로 가시화가 늦어져 createdAt < 어떤 폴링의
      //   serverTime 인데도 아직 안 보이는 창이 생긴다 → 그 폴링이 커서(since)를 serverTime 으로 올려버려
      //   나중에 도착한 이 메시지를 영원히 건너뛴다. 잠금 안 스탬프는 "가시화 시각 ≈ createdAt" 을 보장한다.
      let messageItem = null;
      let data;
      try {
        data = await appendMessage(roomId, (existing) => {
          const prevMessages = existing?.messages || [];
          const prevMembers = existing?.members || [];
          // STAGE 4 보안: 기존 방 + 멤버명단 있음 + 발신자 비멤버 + 코드방 아님 → 임의 전송 차단.
          if (existing && !isCodeRoom(roomId)) {
            const pm = prevMembers.map(String);
            if (pm.length && !pm.includes(String(userId))) {
              throw httpError(403, "이 방의 멤버가 아니어서 전송할 수 없습니다.");
            }
          }
          // clientId 멱등: 클라 재시도(백오프)로 같은 전송이 두 번 와도 중복 저장 금지.
          if (clientId && prevMessages.some((m) => m && m.clientId === clientId)) return null;
          messageItem = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            clientId,   // 클라 임시 id 에코 → 프런트가 id 기준으로 정확히 dedup
            sender, userId, message,
            fileName: fileName || null,
            fileUrl: fileUrl || null,
            mimeType,
            createdAt: new Date().toISOString()   // ★잠금 안에서 스탬프
          };
          const allMembers = [...new Set([...prevMembers, ...members])];
          return {
            ...(existing || {}),   // reads/left 등 기존 필드 보존
            type: "memberChat",
            roomId, title: existing?.title || title,
            members: allMembers,
            lastMessage: message || ("📎 " + fileName),
            updatedAt: new Date().toISOString(),
            messages: [...prevMessages, messageItem]
          };
        });
      } catch (e) {
        if (e && e.httpStatus) return res.status(e.httpStatus).json({ ok: false, message: e.message });
        if (e && e.stage === "load") {
          // 읽기 오류를 새 방으로 오인하면 messages:[]로 덮어써 대화가 소실된다 → 503.
          console.error('[chat-room:send] 방 읽기 오류:', String(e?.message || e));
          return res.status(503).json({ ok: false, message: "채팅방을 잠시 읽지 못했습니다. 다시 시도해주세요." });
        }
        console.error('[chat-room:send] 저장 오류:', String(e?.message || e));
        return res.status(503).json({ ok: false, message: "메시지 저장에 실패했습니다. 다시 시도해주세요." });
      }
      // 멱등 히트 시 기존 메시지를, 아니면 방금 append 한 메시지를 에코
      const echoed = messageItem || (clientId && (data.messages || []).find((m) => m && m.clientId === clientId)) || (data.messages || [])[(data.messages || []).length - 1];
      const lastAt = msgTime(echoed);
      // 백그라운드 Web Push(VAPID 키 설정 시에만 동작, 실패 무해) — 응답을 막지 않는다.
      try {
        sendChatPush({
          members: data.members || members, senderId: userId, senderName: sender,
          title: data.title || title, body: message || ("📎 " + fileName), roomId
        }).catch(() => {});
      } catch (e) {}
      return res.status(200).json({ ok: true, saved: true, message: echoed, lastMessageAt: lastAt, messageCount: (data.messages || []).length });
    }

    // ── 멤버 초대/합류 (members 갱신, 재초대 시 left 해제) ── STAGE 4
    if (action === "invite" || action === "join") {
      const body = req.body || {};
      const roomId = makeRoomId(body.roomId || body.room);
      const title = clean(body.title || body.roomName || "");
      const add = (Array.isArray(body.members) ? body.members : [body.userId]).map(clean).filter(Boolean);
      if (!roomId || !add.length) return res.status(400).json({ ok: false, message: "roomId, members 필요" });
      let data;
      try {
        data = await mutateRoom(roomId, (existing) => {
          const base = existing || { type: "memberChat", roomId, title: title || roomId, members: [], messages: [] };
          const prevMembers = Array.isArray(base.members) ? base.members.map(String) : [];
          const newMembers = [...new Set([...prevMembers, ...add])];
          const prevLeft = Array.isArray(base.left) ? base.left.map(String) : [];
          const newLeft = prevLeft.filter((l) => !add.includes(l));
          return {
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
        });
      } catch (e) {
        if (e && e.stage === "load") {
          console.error('[chat-room:invite] 방 읽기 오류:', String(e?.message || e));
          return res.status(503).json({ ok: false, message: "채팅방을 잠시 읽지 못했습니다. 다시 시도해주세요." });
        }
        throw e;
      }
      return res.status(200).json({ ok: true, members: data.members, left: data.left });
    }

    // ── 이모지 반응 토글 ── STAGE 8
    if (action === "react") {
      const body = req.body || {};
      const roomId = makeRoomId(body.roomId);
      const messageId = clean(body.messageId);
      const userId = clean(body.userId);
      const emoji = clean(body.emoji).slice(0, 8);
      if (!roomId || !messageId || !userId || !emoji) return res.status(400).json({ ok: false, message: "roomId, messageId, userId, emoji 필요" });
      let reactions = null;
      try {
        await mutateRoom(roomId, (existing) => {
          if (!existing) throw httpError(404, "방 없음");
          if (!isCodeRoom(roomId) && !isMember(existing, userId)) throw httpError(403, "이 방의 멤버가 아닙니다.");
          const messages = (existing.messages || []).slice();
          const idx = messages.findIndex((m) => m.id === messageId);
          if (idx === -1) throw httpError(404, "메시지 없음");
          const next = { ...(messages[idx].reactions || {}) };
          const users = Array.isArray(next[emoji]) ? next[emoji].map(String) : [];
          next[emoji] = users.includes(userId) ? users.filter((u) => u !== userId) : [...users, userId];  // 토글
          if (next[emoji].length === 0) delete next[emoji];
          messages[idx] = { ...messages[idx], reactions: next };
          reactions = next;
          return { ...existing, messages };
        });
      } catch (e) {
        if (e && e.httpStatus) return res.status(e.httpStatus).json({ ok: false, message: e.message });
        throw e;
      }
      emitRoomChanged(roomId);
      return res.status(200).json({ ok: true, reactions });
    }

    // ── 내가 속한 방 목록 (캐시 응답 + per-user 안읽음 수) ──
    if (action === "list") {
      const userId = clean(req.query.userId || req.body?.userId);
      const summaries = await listRoomSummaries();
      const rooms = [];
      for (const { roomId, data } of summaries) {
        try {
          // C3: 나간 사람/soft-deleted 방 제외 (재동기화로 부활 방지)
          if (!shouldListRoom(data, userId)) continue;
          const msgs = data.messages || [];
          const lastMsg = msgs[msgs.length - 1];
          const lastAt = lastMsg ? (function (m) { const t = new Date(m.createdAt || m.at || m.time || 0).getTime(); return isNaN(t) ? (Number(m.at) || 0) : t; })(lastMsg) : 0;
          const reads = userId ? await getReads(roomId) : {};
          rooms.push({
            roomId: data.roomId || roomId,
            title: data.title,
            members: data.members || [],
            lastMessage: data.lastMessage || "",
            updatedAt: data.updatedAt,
            messageCount: msgs.length,
            lastMessageAt: lastAt,
            lastMessageFrom: lastMsg ? String(lastMsg.userId || lastMsg.sender || "") : "",
            unread: userId ? countUnread(data, reads, userId) : 0   // 이 기기에서 안 연 방도 정확한 뱃지
          });
        } catch (e) {}
      }
      rooms.sort((a, b) => (b.lastMessageAt || new Date(b.updatedAt || 0).getTime() || 0) - (a.lastMessageAt || new Date(a.updatedAt || 0).getTime() || 0));
      return res.status(200).json({ ok: true, rooms });
    }

    // ── 개별 메시지 삭제 (soft delete) ──
    if (action === "delete-message") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const messageId = clean(req.body?.messageId || req.query.messageId);
      const userId = clean(req.body?.userId || req.query.userId);
      if (!roomId || !messageId) return res.status(400).json({ ok: false, message: "roomId, messageId 필요" });
      try {
        await mutateRoom(roomId, (existing) => {
          if (!existing) throw httpError(404, "방 없음");
          const messages = (existing.messages || []).slice();
          const idx = messages.findIndex((m) => m.id === messageId);
          if (idx === -1) throw httpError(404, "메시지 없음");
          // 본인 메시지만 삭제 가능
          if (userId && messages[idx].userId && messages[idx].userId !== userId) {
            throw httpError(403, "본인 메시지만 삭제할 수 있습니다.");
          }
          // soft delete: 내용은 지우되 "삭제된 메시지입니다" 표시 (카톡 방식)
          messages[idx] = { ...messages[idx], message: "", fileName: null, fileUrl: null, deleted: true, deletedAt: new Date().toISOString() };
          return { ...existing, messages };
        });
      } catch (e) {
        if (e && e.httpStatus) return res.status(e.httpStatus).json({ ok: false, message: e.message });
        throw e;
      }
      emitRoomChanged(roomId);
      return res.status(200).json({ ok: true, message: "메시지 삭제됨" });
    }

    // ── 방 삭제 (soft delete) ──
    if (action === "delete") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      try {
        await mutateRoom(roomId, (existing) => {
          if (!existing) throw httpError(404, "방 없음");
          // STAGE 4 보안: 멤버만 삭제 가능 (레거시 멤버없음 방은 통과)
          if (userId && !isMember(existing, userId)) throw httpError(403, "이 방의 멤버만 삭제할 수 있습니다.");
          return { ...existing, deleted: true, deletedAt: new Date().toISOString() };
        });
      } catch (e) {
        if (e && e.httpStatus) return res.status(e.httpStatus).json({ ok: false, message: e.message });
        throw e;
      }
      return res.status(200).json({ ok: true, message: "방 삭제됨" });
    }

    // ── 방 나가기 (C3: 멤버에서 제외 + left 기록, 영구 반영) ──
    if (action === "leave") {
      const roomId = makeRoomId(req.body?.roomId || req.query.roomId);
      const userId = clean(req.body?.userId || req.query.userId);
      if (!roomId || !userId) return res.status(400).json({ ok: false, message: "roomId, userId 필요" });
      let patched = null;
      await mutateRoom(roomId, (existing) => {
        if (!existing) return null;   // 멱등: 이미 없음
        patched = applyLeave(existing, userId);
        return patched;
      });
      if (!patched) return res.status(200).json({ ok: true, message: "이미 없음" });
      return res.status(200).json({ ok: true, members: patched.members, left: patched.left, deleted: !!patched.deleted });
    }

    return res.status(400).json({ ok: false, message: "Unknown action: " + action });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
