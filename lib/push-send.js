/*
 * 서버 Web Push 발송 — VAPID 키가 있을 때만 동작. 키 없으면 즉시 no-op(기존 동작 영향 0).
 * web-push 라이브러리는 키가 있을 때만 동적 import(샌드박스/미설정 환경에서 import 시도조차 안 함).
 */
import { vapidConfigured, pushTargets, buildPushPayload } from "./push-util.js";
import { getUserSubscriptions } from "../api/push-subscribe.js";

let _webpush = null;
let _configured = false;
async function getWebpush() {
  if (_webpush) return _webpush;
  const mod = await import("web-push");
  _webpush = mod.default || mod;
  if (!_configured) {
    _webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:yesblue0342@gmail.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    _configured = true;
  }
  return _webpush;
}

// 방 멤버(발신자 제외)에게 푸시. 비차단 사용 권장(await하되 호출부에서 try/catch).
// 반환: { enabled, sent, failed }. 키 없으면 enabled:false.
export async function sendRoomPush({ members, senderId, title, body, roomId }) {
  if (!vapidConfigured(process.env)) return { enabled: false, sent: 0, failed: 0 };
  const targets = pushTargets(members, senderId);
  if (!targets.length) return { enabled: true, sent: 0, failed: 0 };
  const payload = buildPushPayload({ title, body, roomId });
  let sent = 0, failed = 0;
  let webpush;
  try { webpush = await getWebpush(); } catch (e) { return { enabled: true, sent: 0, failed: 0, error: "web-push 로드 실패" }; }
  for (const uid of targets) {
    const subs = await getUserSubscriptions(uid).catch(() => []);
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
        sent++;
      } catch (e) {
        failed++; // 만료(410/404)는 다음 단계에서 정리 가능. 여기선 무해 통과.
      }
    }
  }
  return { enabled: true, sent, failed };
}
