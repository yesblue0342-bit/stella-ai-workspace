/*
 * Web Push 구독 API — talk.html subscribePush() 가 호출.
 *  GET  ?action=key  → { ok, enabled, publicKey }
 *    (VAPID 키: env → Drive 저장분 → 서버가 자동 생성·영속. 일시 오류 시에만 enabled:false)
 *  POST { userId, subscription } → 구독 저장(endpoint 기준 upsert)
 */
import { getVapidKeys, saveSubscription } from "../lib/push-send.js";

const clean = (v) => String(v || "").trim();

export default async function handler(req, res) {
  try {
    const action = clean(req.query.action || req.body?.action || "");
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
