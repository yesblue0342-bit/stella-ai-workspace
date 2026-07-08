// Stella Talk 실시간 롱폴링 엔드포인트 — 이벤트 기반(대기 중 Drive 호출 0).
// since(ms epoch) 이후 새 메시지가 생기면 즉시 반환, 없으면 최대 ~25초 대기 후 빈 결과 반환.
// (25초 타임아웃 — 프록시 유휴 끊김/좀비 연결 방지. 클라이언트는 응답 즉시 다시 호출.)
// 실패하면 talk.html 의 적응형 폴링으로 폴백한다.
import { waitForMessages, loadRoom } from "../lib/chat-store.js";

const clean = (v) => String(v || "").trim();
const makeRoomId = (v) => (clean(v) || "default-room").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 80);
const msgTime = (m) => { const t = new Date(m && m.createdAt).getTime(); return isNaN(t) ? 0 : t; };
const isCodeRoom = (roomId) => String(roomId || "").startsWith("room_code_");
const isMember = (data, userId) => {
  const members = Array.isArray(data?.members) ? data.members.map(String) : [];
  if (!members.length) return true;      // 레거시(멤버없음) 방은 허용
  return members.includes(String(userId || ""));
};

export default async function handler(req, res) {
  try {
    const roomId = makeRoomId(req.query.roomId || req.query.room);
    if (!roomId) return res.status(400).json({ ok: false, message: "roomId 필요" });
    const since = Number(req.query.since || 0) || 0;
    // STAGE 4 보안: get 과 동일한 멤버십 게이트 — 비멤버가 임의 roomId 로 새 메시지를 실시간 구독하는 것 차단.
    // (userId 없이 호출하는 레거시 경로는 통과. 코드방/레거시 무멤버 방도 통과.)
    const requester = clean(req.query.userId);
    if (requester && !isCodeRoom(roomId)) {
      const room = await loadRoom(roomId).catch(() => null);
      if (room && !isMember(room, requester)) {
        return res.status(403).json({ ok: false, message: "이 방의 멤버가 아닙니다." });
      }
    }
    const { fresh, all } = await waitForMessages(roomId, since, 25000);
    const last = all[all.length - 1];
    return res.status(200).json({
      ok: true,
      messages: fresh,
      serverTime: Date.now(),
      lastMessageAt: last ? msgTime(last) : 0,
      total: all.length,
      timedOut: fresh.length === 0
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}
