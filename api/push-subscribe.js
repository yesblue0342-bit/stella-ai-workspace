// POST /api/push-subscribe — 브라우저 Web Push 구독 저장(사용자별, Drive).
//   GET  ?action=key   → VAPID 공개키 반환(클라가 pushManager.subscribe에 사용). 키 없으면 enabled:false.
//   POST {userId, subscription}            → 구독 upsert
//   POST {userId, subscription, unsubscribe:true} → 해당 endpoint 제거
// VAPID 키 미설정이면 모두 무해하게 동작(enabled:false). 신규 키/시크릿은 코드/로그에 노출하지 않는다.
import { saveJsonToDrive, readJsonFromDrive } from "../lib/drive-utils.js";
import { vapidConfigured, normalizeSubscription, upsertSubscription } from "../lib/push-util.js";

const clean = (v) => String(v || "").trim();
const subFile = (userId) => "sub_" + clean(userId).replace(/[^a-zA-Z0-9가-힣_.@-]/g, "_").slice(0, 80);

export const config = { maxDuration: 15 };

async function readSubs(userId) {
  const f = await readJsonFromDrive({ folderPath: ["MemberChat", "_push"], fileName: subFile(userId) }).catch(() => null);
  return Array.isArray(f?.data?.subs) ? f.data.subs : [];
}
async function writeSubs(userId, subs) {
  await saveJsonToDrive({ folderPath: ["MemberChat", "_push"], fileName: subFile(userId), data: { type: "pushSubs", userId, subs, updatedAt: new Date().toISOString() } });
}

export default async function handler(req, res) {
  try {
    const action = clean(req.query.action || req.body?.action);
    const enabled = vapidConfigured(process.env);

    if (req.method === "GET" || action === "key") {
      // 공개키만 노출(공개키는 비밀이 아님). 미설정 시 enabled:false → 클라가 구독 시도 안 함.
      return res.status(200).json({ ok: true, enabled, publicKey: enabled ? process.env.VAPID_PUBLIC_KEY : "" });
    }

    if (req.method !== "POST") return res.status(405).json({ ok: false, message: "POST only" });

    const userId = clean(req.body?.userId);
    if (!userId) return res.status(400).json({ ok: false, message: "userId 필요" });
    if (!enabled) return res.status(200).json({ ok: true, enabled: false }); // 키 없으면 저장 생략

    const sub = req.body?.subscription;
    const norm = normalizeSubscription(sub);
    if (!norm) return res.status(400).json({ ok: false, message: "유효하지 않은 구독" });

    let subs = await readSubs(userId);
    if (req.body?.unsubscribe) {
      subs = subs.filter((s) => s && s.endpoint !== norm.endpoint);
    } else {
      subs = upsertSubscription(subs, norm);
    }
    await writeSubs(userId, subs);
    return res.status(200).json({ ok: true, enabled: true, count: subs.length });
  } catch (e) {
    return res.status(200).json({ ok: false, message: "구독 처리 실패", error: String(e && e.message || e) });
  }
}

// 다른 서버 모듈에서 사용자 구독 읽기(푸시 발송용).
export async function getUserSubscriptions(userId) {
  try {
    const f = await readJsonFromDrive({ folderPath: ["MemberChat", "_push"], fileName: subFile(userId) }).catch(() => null);
    return Array.isArray(f?.data?.subs) ? f.data.subs : [];
  } catch { return []; }
}
