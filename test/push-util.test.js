// Web Push 순수 헬퍼 테스트. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { vapidConfigured, normalizeSubscription, upsertSubscription, pushTargets, buildPushPayload } from "../lib/push-util.js";

test("vapidConfigured: 두 키 모두 있을 때만 true", () => {
  assert.equal(vapidConfigured({}), false);
  assert.equal(vapidConfigured({ VAPID_PUBLIC_KEY: "p" }), false);
  assert.equal(vapidConfigured({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" }), true);
});

test("normalizeSubscription: 유효/무효", () => {
  const ok = normalizeSubscription({ endpoint: "https://fcm.example/abc", keys: { p256dh: "k", auth: "a" } });
  assert.deepEqual(ok, { endpoint: "https://fcm.example/abc", keys: { p256dh: "k", auth: "a" } });
  assert.equal(normalizeSubscription(null), null);
  assert.equal(normalizeSubscription({ endpoint: "ftp://x", keys: { p256dh: "k", auth: "a" } }), null);
  assert.equal(normalizeSubscription({ endpoint: "https://x", keys: { p256dh: "k" } }), null);
});

test("upsertSubscription: endpoint 기준 중복 교체", () => {
  let l = upsertSubscription([], { endpoint: "https://a", keys: { p256dh: "k", auth: "a" } });
  assert.equal(l.length, 1);
  l = upsertSubscription(l, { endpoint: "https://a", keys: { p256dh: "k2", auth: "a2" } }); // 같은 endpoint → 교체
  assert.equal(l.length, 1);
  assert.equal(l[0].keys.p256dh, "k2");
  l = upsertSubscription(l, { endpoint: "https://b", keys: { p256dh: "k", auth: "a" } }); // 새 endpoint → 추가
  assert.equal(l.length, 2);
  l = upsertSubscription(l, { endpoint: "bad" }); // 무효 → 무시
  assert.equal(l.length, 2);
});

test("pushTargets: 발신자 제외 + 중복/빈값 제거", () => {
  assert.deepEqual(pushTargets(["a", "b", "c"], "a"), ["b", "c"]);
  assert.deepEqual(pushTargets(["a", "a", "b", "", " ", "b"], "x"), ["a", "b"]);
  assert.deepEqual(pushTargets([], "a"), []);
  assert.deepEqual(pushTargets(["a"], "a"), []);
});

test("buildPushPayload: 기본값/roomId url", () => {
  const p = JSON.parse(buildPushPayload({ title: "앵별♡", body: "안녕", roomId: "r1" }));
  assert.equal(p.title, "앵별♡");
  assert.equal(p.body, "안녕");
  assert.equal(p.roomId, "r1");
  assert.equal(p.url, "/talk?room=r1");
  const d = JSON.parse(buildPushPayload({}));
  assert.equal(d.title, "Stella Talk");
  assert.equal(d.url, "/talk");
});

test("buildPushPayload: senderId 포함(수신 창 자기수신 방어값)", () => {
  const p = JSON.parse(buildPushPayload({ title: "t", body: "b", roomId: "r1", senderId: "userA" }));
  assert.equal(p.senderId, "userA");
  const d = JSON.parse(buildPushPayload({ roomId: "r1" }));
  assert.equal(d.senderId, "");   // 미지정 시 빈 문자열(수신자는 항상 통과)
});
