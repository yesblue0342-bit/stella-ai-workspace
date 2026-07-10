/*
 * lib/push-send.js — VAPID 키 자동 부트스트랩 계약 테스트 (가짜 저장소 주입).
 *  1) env 키 없고 저장분 없음 → 생성 + 영속화, 같은 프로세스에서 재호출 시 동일 키
 *  2) 저장분 있음 → 재생성 없이 로드 (키 회전 방지)
 *  3) 저장소 '읽기 오류' → 재생성하지 않고 null(비활성), 복구 후 재시도 성공
 *  4) env 키 있으면 env 우선
 *  5) 구독 upsert 저장/조회
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getVapidKeys, saveSubscription, getSubscriptions, __setStoreForTest, __resetForTest } from "../lib/push-send.js";

function fakeStore(initial = {}) {
  const files = new Map(Object.entries(initial));
  let failReads = false;
  return {
    files,
    setFailReads(v) { failReads = v; },
    ops: {
      async read(fileName) {
        if (failReads) throw Object.assign(new Error("quota"), { code: 429 });
        return files.has(fileName) ? { data: files.get(fileName) } : null;
      },
      async write(fileName, data) { files.set(fileName, JSON.parse(JSON.stringify(data))); return { ok: true }; }
    }
  };
}

const ENV_KEYS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
function clearEnv() {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  return () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

test("VAPID: 없으면 생성·영속화, 재호출 시 동일 키", async () => {
  const restore = clearEnv();
  try {
    __resetForTest();
    const s = fakeStore();
    __setStoreForTest(s.ops);
    const k1 = await getVapidKeys();
    assert.ok(k1 && k1.publicKey && k1.privateKey, "키 생성됨");
    assert.equal(k1.source, "generated");
    assert.ok(s.files.has("__vapid__"), "Drive 영속화됨");
    const k2 = await getVapidKeys();
    assert.equal(k2.publicKey, k1.publicKey, "같은 프로세스 재호출 = 동일 키");
  } finally { __resetForTest(); restore(); }
});

test("VAPID: 저장분 있으면 재생성 없이 로드(키 회전 방지)", async () => {
  const restore = clearEnv();
  try {
    __resetForTest();
    const s = fakeStore({ "__vapid__": { type: "vapidKeys", publicKey: "PUB_SAVED", privateKey: "PRIV_SAVED" } });
    __setStoreForTest(s.ops);
    const k = await getVapidKeys();
    assert.equal(k.publicKey, "PUB_SAVED");
    assert.equal(k.source, "drive");
  } finally { __resetForTest(); restore(); }
});

test("VAPID: 읽기 오류 시 재생성 금지(null) → 복구 후 재시도 성공", async () => {
  const restore = clearEnv();
  try {
    __resetForTest();
    const s = fakeStore({ "__vapid__": { type: "vapidKeys", publicKey: "PUB_SAVED", privateKey: "PRIV_SAVED" } });
    __setStoreForTest(s.ops);
    s.setFailReads(true);
    const k1 = await getVapidKeys();
    assert.equal(k1, null, "오류 시 비활성(키 회전 없음)");
    assert.equal(s.files.get("__vapid__").publicKey, "PUB_SAVED", "저장분 미손상");
    s.setFailReads(false);
    const k2 = await getVapidKeys();
    assert.equal(k2 && k2.publicKey, "PUB_SAVED", "복구 후 저장분 로드");
  } finally { __resetForTest(); restore(); }
});

test("VAPID: env 키가 있으면 env 우선", async () => {
  const restore = clearEnv();
  try {
    __resetForTest();
    process.env.VAPID_PUBLIC_KEY = "ENV_PUB";
    process.env.VAPID_PRIVATE_KEY = "ENV_PRIV";
    __setStoreForTest(fakeStore().ops);
    const k = await getVapidKeys();
    assert.equal(k.publicKey, "ENV_PUB");
    assert.equal(k.source, "env");
  } finally { __resetForTest(); restore(); }
});

test("구독 upsert: endpoint 기준 갱신·조회", async () => {
  const restore = clearEnv();
  try {
    __resetForTest();
    const s = fakeStore();
    __setStoreForTest(s.ops);
    const sub = { endpoint: "https://push.example/ep1", keys: { p256dh: "k1", auth: "a1" } };
    const r = await saveSubscription("userA", sub);
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    // 같은 endpoint 재등록 → 개수 유지(교체)
    const r2 = await saveSubscription("userA", sub);
    assert.equal(r2.count, 1);
    const list = await getSubscriptions("userA");
    assert.equal(list.length, 1);
    assert.equal(list[0].endpoint, sub.endpoint);
  } finally { __resetForTest(); restore(); }
});
