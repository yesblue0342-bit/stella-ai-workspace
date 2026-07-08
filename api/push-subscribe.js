/*
 * Web Push 구독 API — talk.html subscribePush() 가 호출.
 *  GET  ?action=key  → { ok, enabled, publicKey }  (VAPID 미설정이면 enabled:false — 클라 조용히 종료)
 *  POST { userId, subscription } → 구독 저장(endpoint 기준 upsert)
 */
import { pushEnabled, publicVapidKey, saveSubscription } from "../lib/push-send.js";

const clean = (v) => String(v || "").trim();

export default async function handler(req, res) {
  try {
    const action = clean(req.query.action || req.body?.action || "");
    if (req.method === "GET" || action === "key") {
      const enabled = pushEnabled();
      return res.status(200).json({ ok: true, enabled, publicKey: enabled ? publicVapidKey() : "" });
    }
    if (req.method === "POST") {
      if (!pushEnabled()) return res.status(200).json({ ok: false, enabled: false, message: "푸시 비활성(VAPID 키 미설정)" });
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
