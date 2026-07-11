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
const ALIAS_FILE = "__alias__";
const subsCache = new Map(); // userId -> { list, loadedAt }
const ALIAS_TTL_MS = 5 * 60 * 1000;
let _aliasCache = null; // { map, at }
let _aliasWriteChain = Promise.resolve(); // 별칭 파일 직렬 쓰기(동시 구독 레이스 방지)

// 저장소 I/O (테스트에서 교체 가능)
let store = {
  read: (fileName) => readJsonFromDrive({ folderPath: SUBS_FOLDER, fileName }),
  write: (fileName, data) => saveJsonToDrive({ folderPath: SUBS_FOLDER, fileName, data })
};
export function __setStoreForTest(s) { store = { ...store, ...s }; }
export function __resetForTest() { subsCache.clear(); _keysPromise = undefined; _wpPromise = undefined; _aliasCache = null; _aliasWriteChain = Promise.resolve(); }

// ── 신원 별칭 맵: 한 사용자의 여러 식별자(id/이름/이메일)를 canonical userId 로 잇는다. ──
//   근본원인①: 방 members[] 에 저장된 값(이름/이메일/구식 id)과 구독 저장 키(getMyId)가
//   달라서 발송 타깃 조회가 빗나가던 문제를, 발송 시 별칭으로 canonical 을 되찾아 해소한다.
const normId = (v) => String(v == null ? "" : v).trim();
async function loadAliasMap() {
  if (_aliasCache && Date.now() - _aliasCache.at < ALIAS_TTL_MS) return _aliasCache.map;
  let map = {};
  try {
    const f = await store.read(ALIAS_FILE);
    if (f?.data?.map && typeof f.data.map === "object") map = f.data.map;
  } catch (e) { /* 없거나 오류 → 빈 맵(직접 값 폴백으로 동작) */ }
  _aliasCache = { map, at: Date.now() };
  return map;
}
// canonicalId 에 identities(id/이름/이메일) 를 별칭으로 등록(직렬 write-through).
async function registerAliases(canonicalId, identities) {
  const canon = normId(canonicalId);
  if (!canon) return;
  const ids = [canon, ...(Array.isArray(identities) ? identities : [])].map(normId).filter(Boolean);
  _aliasWriteChain = _aliasWriteChain.then(async () => {
    const map = await loadAliasMap();
    let changed = false;
    for (const id of ids) { if (map[id] !== canon) { map[id] = canon; changed = true; } }
    if (!changed) return;
    _aliasCache = { map, at: Date.now() };
    try { await store.write(ALIAS_FILE, { type: "pushAlias", map, updatedAt: new Date().toISOString() }); }
    catch (e) { console.error("[push-send] 별칭 저장 실패:", String(e?.message || e)); }
  }).catch(() => {});
  return _aliasWriteChain;
}
// 멤버값 → 구독을 찾을 후보 id 집합(자기 자신 + 별칭 canonical). endpoint 로 최종 dedupe.
function candidateIdsFor(value, aliasMap) {
  const v = normId(value);
  const out = new Set();
  if (v) out.add(v);
  if (aliasMap && aliasMap[v]) out.add(normId(aliasMap[v]));
  return [...out];
}

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
const SUBS_TTL_MS = 10 * 60 * 1000;

// ★조용한 실패 방지: 기존엔 Drive 읽기 '오류'도 빈 목록 [] 으로 영구 캐시 → 그 사용자에게
//   가는 모든 푸시가 재시작 전까지 소리 없이 스킵됐다. 오류는 캐시하지 않고(다음 호출 재시도),
//   strict 모드에선 throw(저장 경로에서 타 기기 구독을 []로 덮어쓰는 파괴 방지). TTL 10분.
export async function getSubscriptions(userId, opts = {}) {
  const c = subsCache.get(userId);
  if (c && (Date.now() - c.loadedAt) < SUBS_TTL_MS) return c.list;
  let f;
  try {
    f = await store.read(subFile(userId));   // '파일 없음' = null, 실제 오류는 throw
  } catch (e) {
    console.error("[push-send] 구독 읽기 오류:", userId, String(e?.message || e));
    if (opts.strict) throw e;                 // 저장 경로: 덮어쓰기 금지
    if (c) return c.list;                     // 만료된 캐시라도 있으면 그걸로(오류 시 폴백)
    return [];                                // 캐시하지 않음 → 다음 호출 때 재시도
  }
  const list = Array.isArray(f?.data?.subs) ? f.data.subs : [];
  subsCache.set(userId, { list, loadedAt: Date.now() });
  return list;
}

export async function saveSubscription(userId, subscription, altIds) {
  const norm = normalizeSubscription(subscription);
  if (!norm) return { ok: false, message: "유효하지 않은 구독" };
  let cur;
  try {
    cur = await getSubscriptions(userId, { strict: true });   // 읽기 오류 시 여기서 중단(clobber 방지)
  } catch (e) {
    return { ok: false, message: "구독 저장소를 잠시 읽지 못했습니다. 다시 시도해주세요." };
  }
  const list = upsertSubscription(cur, norm);
  subsCache.set(userId, { list, loadedAt: Date.now() });
  await store.write(subFile(userId), { type: "pushSubs", userId, subs: list });
  // 이 사용자의 모든 식별자를 canonical(userId)로 별칭 등록 → 다른 표기의 멤버값으로도 도달 가능.
  try { await registerAliases(userId, altIds); } catch (e) {}
  return { ok: true, count: list.length };
}

async function removeSubscription(userId, endpoint) {
  const cur = await getSubscriptions(userId);
  const list = cur.filter((s) => s && s.endpoint !== endpoint);
  if (list.length === cur.length) return;
  subsCache.set(userId, { list, loadedAt: Date.now() });
  try { await store.write(subFile(userId), { type: "pushSubs", userId, subs: list }); } catch (e) {}
}

// 구독 목록에 payload 발송(공통). 404/410 만료 구독은 정리, 그 외 오류는 로그+집계(조용한 실패 금지).
async function sendToSubs(wp, uid, subs, payload) {
  let sent = 0; const errors = [];
  for (const sub of subs) {
    try {
      await wp.sendNotification(sub, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = e?.statusCode || 0;
      if (code === 404 || code === 410) { removeSubscription(uid, sub.endpoint).catch(() => {}); }
      else {
        // 401/403 = VAPID 키 불일치(구독이 옛 키로 등록됨) 등 — 반드시 로그로 드러낸다.
        console.error("[push-send] 발송 실패:", uid, "status=" + code, String(e?.body || e?.message || e).slice(0, 200));
        errors.push({ userId: uid, status: code });
      }
    }
  }
  return { sent, errors };
}

// 멤버 목록(발신자 제외)을 별칭 해석해 '보낼 (구독소유자id, 구독)' 쌍을 endpoint 기준 중복 제거.
async function resolveDeliveries(members, senderId) {
  const targets = pushTargets(members, senderId);  // 발신자 제외 + 중복 제거된 멤버값
  if (!targets.length) return [];
  const aliasMap = await loadAliasMap();
  // 멤버값 → 후보 canonical id 집합(자기값 + 별칭). 전체 후보 id 를 dedupe.
  const candidateIds = new Set();
  for (const m of targets) for (const id of candidateIdsFor(m, aliasMap)) candidateIds.add(id);
  // 각 후보 id 의 구독을 모으되, endpoint 로 최종 dedupe(한 기기에 중복 발송 방지 — 여러 별칭 파일에 같은 구독이 있어도 1회).
  const byEndpoint = new Map(); // endpoint -> { ownerId, sub }
  for (const id of candidateIds) {
    let subs = [];
    try { subs = await getSubscriptions(id); } catch (e) { continue; }
    for (const sub of subs) {
      if (sub && sub.endpoint && !byEndpoint.has(sub.endpoint)) byEndpoint.set(sub.endpoint, { ownerId: id, sub });
    }
  }
  return [...byEndpoint.values()];
}

// 방 멤버(발신자 제외)에게 푸시. 실패는 무해(만료 구독 404/410 은 자동 정리).
export async function sendChatPush({ members, senderId, senderName, title, body, roomId } = {}) {
  const wp = await getWebPush();
  if (!wp) return { sent: 0, disabled: true };
  const deliveries = await resolveDeliveries(members, senderId);
  if (!deliveries.length) {
    // 타깃은 있으나 구독을 못 찾음 = 그 사람 미구독/신원불일치 → 조용히 넘기지 말고 로그로 드러냄.
    const targets = pushTargets(members, senderId);
    if (targets.length) console.warn("[push-send] 발송 대상 구독 없음 room=%j targets=%j", roomId, targets);
    return { sent: 0 };
  }
  const text = String(body || "").slice(0, 120);
  const payload = buildPushPayload({
    title,
    body: senderName ? (String(senderName).slice(0, 20) + ": " + text) : text,   // 카톡처럼 "보낸이: 내용"
    roomId,
    senderId   // 수신 창의 자기수신 방어
  });
  let sent = 0; const errors = [];
  for (const { ownerId, sub } of deliveries) {
    const r = await sendToSubs(wp, ownerId, [sub], payload);
    sent += r.sent; errors.push(...r.errors);
  }
  return { sent, errors };
}

// 자기 자신에게 보내는 E2E 테스트 푸시 — 폰에서 "서버→FCM→SW→팝업" 전체 체인을 직접 검증.
// delayMs 동안 기다렸다 발송(사용자가 앱을 백그라운드로 내릴 시간 확보).
export async function sendTestPush(userId, { delayMs = 0 } = {}) {
  const wp = await getWebPush();
  if (!wp) return { ok: false, sent: 0, disabled: true, message: "서버 푸시 비활성(키 준비 실패)" };
  let subs;
  try { subs = await getSubscriptions(userId, { strict: true }); }
  catch (e) { return { ok: false, sent: 0, message: "구독 저장소 읽기 실패 — 잠시 후 재시도" }; }
  if (!subs.length) return { ok: false, sent: 0, message: "이 계정의 푸시 구독이 없습니다 — 알림 권한 허용 후 다시 시도" };
  if (delayMs > 0) await new Promise((r) => setTimeout(r, Math.min(delayMs, 15000)));
  const payload = buildPushPayload({ title: "백그라운드 테스트", body: "이 팝업이 보이면 성공! 🎉", roomId: "" });
  const r = await sendToSubs(wp, userId, subs, payload);
  return { ok: r.sent > 0, sent: r.sent, tried: subs.length, errors: r.errors };
}
