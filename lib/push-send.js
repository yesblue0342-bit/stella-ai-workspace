/*
 * Web Push 발송 — Stella Talk 백그라운드 알림(앱/브라우저가 닫혀 있어도 수신).
 *
 * 동작 조건: .env 에 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 가 있고 web-push 패키지가 설치된 경우.
 * 둘 중 하나라도 없으면 완전 no-op — 기존 폴링 알림 동작에 영향 0.
 * (키 생성: npx web-push generate-vapid-keys → OCI .env 에 추가 후 재배포)
 *
 * 구독 저장: Drive `PushSubs/subs_<userId>.json` (인메모리 캐시 + write-through).
 */
import { vapidConfigured, normalizeSubscription, upsertSubscription, pushTargets, buildPushPayload } from "./push-util.js";
import { saveJsonToDrive, readJsonFromDrive } from "./drive-utils.js";

const SUBS_FOLDER = ["PushSubs"];
const subsCache = new Map(); // userId -> { list, loadedAt }

let _webpushPromise;
async function getWebPush() {
  if (!vapidConfigured(process.env)) return null;
  if (_webpushPromise === undefined) {
    _webpushPromise = import("web-push").then((m) => {
      const wp = m.default || m;
      const subject = process.env.VAPID_SUBJECT || "mailto:yesblue0342@gmail.com";
      wp.setVapidDetails(subject.startsWith("mailto:") || subject.startsWith("http") ? subject : "mailto:" + subject,
        process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      return wp;
    }).catch((e) => {
      console.error("[push-send] web-push 로드 실패(패키지 미설치?):", String(e?.message || e));
      return null;
    });
  }
  return _webpushPromise;
}

export function pushEnabled() {
  return vapidConfigured(process.env);
}

export function publicVapidKey() {
  return String(process.env.VAPID_PUBLIC_KEY || "").trim();
}

const subFile = (userId) => "subs_" + String(userId || "").replace(/[^a-zA-Z0-9가-힣_@.-]/g, "_").slice(0, 100);

export async function getSubscriptions(userId) {
  const c = subsCache.get(userId);
  if (c) return c.list;
  let list = [];
  try {
    const f = await readJsonFromDrive({ folderPath: SUBS_FOLDER, fileName: subFile(userId) });
    list = Array.isArray(f?.data?.subs) ? f.data.subs : [];
  } catch (e) { list = []; }
  subsCache.set(userId, { list, loadedAt: Date.now() });
  return list;
}

export async function saveSubscription(userId, subscription) {
  const norm = normalizeSubscription(subscription);
  if (!norm) return { ok: false, message: "유효하지 않은 구독" };
  const cur = await getSubscriptions(userId);
  const list = upsertSubscription(cur, norm);
  subsCache.set(userId, { list, loadedAt: Date.now() });
  await saveJsonToDrive({ folderPath: SUBS_FOLDER, fileName: subFile(userId), data: { type: "pushSubs", userId, subs: list } });
  return { ok: true, count: list.length };
}

async function removeSubscription(userId, endpoint) {
  const cur = await getSubscriptions(userId);
  const list = cur.filter((s) => s && s.endpoint !== endpoint);
  if (list.length === cur.length) return;
  subsCache.set(userId, { list, loadedAt: Date.now() });
  try { await saveJsonToDrive({ folderPath: SUBS_FOLDER, fileName: subFile(userId), data: { type: "pushSubs", userId, subs: list } }); } catch (e) {}
}

// 방 멤버(발신자 제외)에게 푸시. 실패는 무해(만료 구독 404/410 은 자동 정리).
export async function sendChatPush({ members, senderId, title, body, roomId } = {}) {
  const wp = await getWebPush();
  if (!wp) return { sent: 0, disabled: true };
  const targets = pushTargets(members, senderId);
  if (!targets.length) return { sent: 0 };
  const payload = buildPushPayload({ title, body: String(body || "").slice(0, 120), roomId });
  let sent = 0;
  for (const uid of targets) {
    let subs = [];
    try { subs = await getSubscriptions(uid); } catch (e) { continue; }
    for (const sub of subs) {
      try {
        await wp.sendNotification(sub, payload, { TTL: 3600 });
        sent++;
      } catch (e) {
        const code = e?.statusCode || 0;
        if (code === 404 || code === 410) removeSubscription(uid, sub.endpoint).catch(() => {});
      }
    }
  }
  return { sent };
}
