/*
 * Web Push(VAPID) 순수 헬퍼 — Stella Talk 백그라운드 알림.
 * 네트워크/암호화는 web-push 라이브러리가 담당. 여기서는 게이트/정규화/타깃 선정만(테스트 가능).
 * VAPID 키가 env에 없으면 푸시 경로는 완전 비활성(no-op) → 키 추가 전까지 기존 동작에 영향 0.
 */

// 두 VAPID 키가 모두 있을 때만 푸시 활성.
export function vapidConfigured(env = {}) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

// 브라우저 PushSubscription 정규화. 유효하지 않으면 null.
export function normalizeSubscription(sub) {
  if (!sub || typeof sub !== "object") return null;
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
  if (!/^https?:\/\//.test(endpoint)) return null;
  const keys = sub.keys && typeof sub.keys === "object" ? sub.keys : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  if (!p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// 구독 목록에 endpoint 기준 upsert(중복 endpoint는 최신으로 교체).
export function upsertSubscription(list, sub) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const norm = normalizeSubscription(sub);
  if (!norm) return arr;
  const i = arr.findIndex((s) => s && s.endpoint === norm.endpoint);
  const entry = { ...norm, updatedAt: Date.now() };
  if (i >= 0) arr[i] = entry; else arr.push(entry);
  return arr;
}

// 푸시 보낼 대상 userId 목록 = 멤버 - 발신자(중복/빈값 제거).
export function pushTargets(members, senderId) {
  const sender = String(senderId == null ? "" : senderId);
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(members) ? members : []) {
    const id = String(m == null ? "" : m).trim();
    if (!id || id === sender || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// 알림 페이로드(JSON 문자열). sw.js push 핸들러가 title/body/url/roomId/senderId 사용.
// senderId: 수신 창이 '내가 보낸 메시지의 푸시'(타깃 계산 엣지케이스)를 무시하기 위한 방어값.
export function buildPushPayload({ title, body, roomId, url, senderId } = {}) {
  return JSON.stringify({
    title: String(title || "Stella Talk"),
    body: String(body || "새 메시지가 도착했습니다."),
    roomId: String(roomId || ""),
    senderId: String(senderId || ""),
    url: url || (roomId ? "/talk?room=" + encodeURIComponent(roomId) : "/talk"),
  });
}
