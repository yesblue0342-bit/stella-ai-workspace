/*
 * Web Push 구독 API — talk.html subscribePush() 가 호출.
 *  GET  ?action=key                 → { ok, enabled, publicKey }
 *  GET  ?action=status&userId=..    → { ok, enabled, keySource, subs }  (폰 자가진단용)
 *  POST { userId, subscription }    → 구독 저장(endpoint 기준 upsert)
 *  POST ?action=test { userId, delaySec } → 본인에게 테스트 푸시(E2E 체인 검증, 지연 후 발송)
 *    (VAPID 키: env → Drive 저장분 → 서버가 자동 생성·영속. 일시 오류 시에만 enabled:false)
 */
import { getVapidKeys, saveSubscription, getSubscriptions, sendTestPush } from "../lib/push-send.js";

const clean = (v) => String(v || "").trim();

export default async function handler(req, res) {
  try {
    const action = clean(req.query.action || req.body?.action || "");

    if (action === "status") {
      const keys = await getVapidKeys();
      const userId = clean(req.query.userId || req.body?.userId);
      let subs = -1;
      if (userId) { try { subs = (await getSubscriptions(userId, { strict: true })).length; } catch (e) { subs = -1; } }
      return res.status(200).json({ ok: true, enabled: !!keys, keySource: keys ? keys.source : "", subs });
    }

    if (action === "test" && req.method === "POST") {
      const userId = clean(req.body?.userId);
      if (!userId) return res.status(400).json({ ok: false, message: "userId 필요" });
      const delaySec = Math.max(0, Math.min(10, Number(req.body?.delaySec) || 0));
      // 지연 발송은 응답을 막지 않는다 — 사용자가 앱을 백그라운드로 내릴 시간을 준 뒤 실제 푸시.
      if (delaySec > 0) {
        const subs = await getSubscriptions(userId).catch(() => []);
        if (!subs.length) return res.status(200).json({ ok: false, message: "이 계정의 푸시 구독이 없습니다 — 알림 권한 허용 후 다시 시도" });
        setTimeout(() => { sendTestPush(userId).then((r) => console.log("[push-test]", userId, JSON.stringify(r))).catch(() => {}); }, delaySec * 1000);
        return res.status(200).json({ ok: true, scheduled: true, delaySec, subs: subs.length });
      }
      const r = await sendTestPush(userId);
      return res.status(200).json(r);
    }

    if (req.method === "GET" || action === "key") {
      const keys = await getVapidKeys();
      return res.status(200).json({ ok: true, enabled: !!keys, publicKey: keys ? keys.publicKey : "" });
    }
    if (req.method === "POST") {
      const keys = await getVapidKeys();
      if (!keys) return res.status(200).json({ ok: false, enabled: false, message: "푸시 일시 비활성(키 준비 실패) — 잠시 후 재시도" });
      const userId = clean(req.body?.userId);
      const subscription = req.body?.subscription;
      if (!userId || !subscription) return res.status(400).json({ ok: false, message: "userId, subscription 필요" });
      const r = await saveSubscription(userId, subscription);
      return res.status(200).json({ ok: !!r.ok, ...r });
    }
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
