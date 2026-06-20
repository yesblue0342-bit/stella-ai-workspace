// Stella Talk 실시간 근접(롱폴링) 엔드포인트 — STAGE 1.
// since(ms epoch) 이후 새 메시지가 생기면 즉시 반환, 없으면 최대 ~25초 대기 후 빈 결과 반환.
// (Vercel maxDuration 30 준수: 25초에서 타임아웃하여 함수 강제종료를 피함.)
// 클라이언트는 응답 즉시 다시 호출(롱폴 체인). 실패하면 talk.html 의 적응형 폴링으로 폴백.
import { readJsonFromDrive } from "../lib/drive-utils.js";

const clean = (v) => String(v || "").trim();
const makeRoomId = (v) => (clean(v) || "default-room").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msgTime = (m) => { const t = new Date(m && m.createdAt).getTime(); return isNaN(t) ? 0 : t; };

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const roomId = makeRoomId(req.query.roomId || req.query.room);
    if (!roomId) return res.status(400).json({ ok: false, message: "roomId 필요" });
    const since = Number(req.query.since || 0) || 0;
    const deadline = Date.now() + 25000;   // 25초 후 타임아웃(빈 결과)
    const gap = 1200;                       // Drive 읽기 간격(과도한 호출 방지)

    while (true) {
      const f = await readJsonFromDrive({ folderPath: ["MemberChat"], fileName: roomId }).catch(() => null);
      const all = (f && f.data && Array.isArray(f.data.messages)) ? f.data.messages : [];
      const fresh = since > 0 ? all.filter((m) => msgTime(m) > since) : all.slice(-100);
      if (fresh.length > 0 || Date.now() >= deadline) {
        const last = all[all.length - 1];
        return res.status(200).json({
          ok: true,
          messages: fresh,
          serverTime: Date.now(),
          lastMessageAt: last ? msgTime(last) : 0,
          total: all.length,
          timedOut: fresh.length === 0
        });
      }
      await sleep(gap);
    }
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}
