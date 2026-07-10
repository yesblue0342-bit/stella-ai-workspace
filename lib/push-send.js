/*
 * Web Push 발송 — Stella Talk 백그라운드 알림(앱/브라우저가 닫혀 있어도 팝업 수신).
 *
 * ★ VAPID 키 자동 부트스트랩: .env 에 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 가 있으면 그것을 쓰고,
 *   없으면 서버가 최초 1회 키쌍을 생성해 Drive `PushSubs/__vapid__.json` 에 저장 후 재사용한다.
 *   → 수동 env 설정 없이도 배포 즉시 푸시가 동작한다(카톡처럼 앱 꺼져도 팝업).
 *   주의: 키를 새로 만들면 기존 구독이 전부 무효가 되므로, Drive '읽기 오류'(쿼터/네트워크)일 땐
 *   절대 재생성하지 않고 이번 요청만 비활성으로 처리한다(다음 요청 때 재시도).
 *
 * 구독 저장: Drive `PushSubs/subs_<userId>.json` (인메모리 캐시 + write-through).
 */
import { vapidConfigured, normalizeSubscription, upsertSubscription, pushTargets, buildPushPayload } from "./push-util.js";
import { saveJsonToDrive, readJsonFromDrive } from "./drive-utils.js";

const SUBS_FOLDER = ["PushSubs"];
const KEYS_FILE = "__vapid__";
const subsCache = new Map(); // userId -> { list, loadedAt }

// 저장소 I/O (테스트에서 교체 가능)
let store = {
  read: (fileName) => readJsonFromDrive({ folderPath: SUBS_FOLDER, fileName }),
  write: (fileName, data) => saveJsonToDrive({ folderPath: SUBS_FOLDER, fileName, data })
};
export function __setStoreForTest(s) { store = { ...store, ...s }; }
export function __resetForTest() { subsCache.clear(); _keysPromise = undefined; _wpPromise = undefined; }

async function importWebPush() {
  const m = await import("web-push");
  return m.default || m;
}

// ── VAPID 키 해석: env → Drive 저장분 → 생성+저장. 실패(읽기 오류) 시 null(재시도 가능). ──
let _keysPromise;
export async function getVapidKeys() {
  if (_keysPromise !== undefined) return _keysPromise;
  _keysPromise = (async () => {
    if (vapidConfigured(process.env)) {
      return {
        publicKey: String(process.env.VAPID_PUBLIC_KEY).trim(),
        privateKey: String(process.env.VAPID_PRIVATE_KEY).trim(),
        source: "env"
      };
    }
    let f = null;
    try {
      f = await store.read(KEYS_FILE);   // '파일 없음' = null, 실제 오류는 throw
    } catch (e) {
      // 읽기 오류를 '없음'으로 오인해 재생성하면 키가 회전되어 기존 구독 전체가 무효화된다 → 이번만 비활성.
      console.error("[push-send] VAPID 키 읽기 오류(재시도 예정):", String(e?.message || e));
      return null;
    }
    if (f?.data?.publicKey && f?.data?.privateKey) {
      return { publicKey: f.data.publicKey, privateKey: f.data.privateKey, source: "drive" };
    }
    // 최초 1회 생성 + 영속화
    try {
      const wp = await importWebPush();
      const keys = wp.generateVAPIDKeys();
      await store.write(KEYS_FILE, { type: "vapidKeys", publicKey: keys.publicKey, privateKey: keys.privateKey, createdAt: new Date().toISOString() });
      console.log("[push-send] VAPID 키 자동 생성·저장 완료 — Web Push 활성");
      return { ...keys, source: "generated" };
    } catch (e) {
      console.error("[push-send] VAPID 키 생성/저장 실패:", String(e?.message || e));
      return null;
    }
  })();
  const p = _keysPromise;
  const r = await p;
  if (r === null && _keysPromise === p) _keysPromise = undefined;   // 실패는 캐시하지 않음(다음 요청 때 재시도)
  return r;
}

let _wpPromise;
async function getWebPush() {
  const keys = await getVapidKeys();
  if (!keys) return null;
  if (_wpPromise === undefined) {
    _wpPromise = importWebPush().then((wp) => {
      const subject = process.env.VAPID_SUBJECT || "mailto:yesblue0342@gmail.com";
      wp.setVapidDetails(
        subject.startsWith("mailto:") || subject.startsWith("http") ? subject : "mailto:" + subject,
        keys.publicKey, keys.privateKey
      );
      return wp;
    }).catch((e) => {
      console.error("[push-send] web-push 로드 실패:", String(e?.message || e));
      return null;
    });
  }
  return _wpPromise;
}

const subFile = (userId) => "subs_" + String(userId || "").replace(/[^a-zA-Z0-9가-힣_@.-]/g, "_").slice(0, 100);

export async function getSubscriptions(userId) {
  const c = subsCache.get(userId);
  if (c) return c.list;
  let list = [];
  try {
    const f = await store.read(subFile(userId));
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
  await store.write(subFile(userId), { type: "pushSubs", userId, subs: list });
  return { ok: true, count: list.length };
}

async function removeSubscription(userId, endpoint) {
  const cur = await getSubscriptions(userId);
  const list = cur.filter((s) => s && s.endpoint !== endpoint);
  if (list.length === cur.length) return;
  subsCache.set(userId, { list, loadedAt: Date.now() });
  try { await store.write(subFile(userId), { type: "pushSubs", userId, subs: list }); } catch (e) {}
}

// 방 멤버(발신자 제외)에게 푸시. 실패는 무해(만료 구독 404/410 은 자동 정리).
export async function sendChatPush({ members, senderId, senderName, title, body, roomId } = {}) {
  const wp = await getWebPush();
  if (!wp) return { sent: 0, disabled: true };
  const targets = pushTargets(members, senderId);
  if (!targets.length) return { sent: 0 };
  const text = String(body || "").slice(0, 120);
  const payload = buildPushPayload({
    title,
    body: senderName ? (String(senderName).slice(0, 20) + ": " + text) : text,   // 카톡처럼 "보낸이: 내용"
    roomId
  });
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
