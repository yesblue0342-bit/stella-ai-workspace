/*
 * lib/push-send.js — 신원 별칭 해석(근본원인①) 계약 테스트.
 *  핵심: 방 members[] 표기(이름/이메일)가 구독 저장 키(canonical userId)와 달라도
 *  발송이 정확히 도달해야 한다("어떤 사람은 안 되는" 편차 제거).
 *  + endpoint 중복 제거(한 기기에 중복 발송 금지) + 발신자 자기수신 제외.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { saveSubscription, sendChatPush, __setStoreForTest, __resetForTest } from "../lib/push-send.js";

// web-push 를 가짜로 — 실제 네트워크 없이 발송 endpoint 만 수집
import { createRequire } from "module";
const require = createRequire(import.meta.url);

function fakeStore(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files, ops: {
    async read(fn) { return files.has(fn) ? { data: files.get(fn) } : null; },
    async write(fn, d) { files.set(fn, JSON.parse(JSON.stringify(d))); return { ok: true }; }
  } };
}

function withEnvKeys(fn) {
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
  // 유효 형식의 더미 키 대신 web-push 를 스텁하므로 값 존재만으로 충분
  process.env.VAPID_PUBLIC_KEY = "BJdummyPublicKeyForTest_0000000000000000000000000000000000000000000000000000000000000000000000000000000";
  process.env.VAPID_PRIVATE_KEY = "dummyPrivateKeyForTest000000000000000000000";
  return Promise.resolve(fn()).finally(() => {
    if (saved.pub === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = saved.pub;
    if (saved.priv === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = saved.priv;
  });
}

// web-push 스텁 — import()가 모듈을 캐시하므로 '한 번만' 설치하고, 발송 수집은 공유 sink 로.
//   (테스트마다 require.cache 를 갈아끼워도 ESM import() 는 첫 인스턴스를 재사용하기 때문)
let _sink = [];
(function stubWebPushOnce() {
  const path = require.resolve("web-push");
  require.cache[path] = { id: path, filename: path, loaded: true, exports: {
    setVapidDetails() {},
    generateVAPIDKeys() { return { publicKey: "pub", privateKey: "priv" }; },
    async sendNotification(sub, payload) { _sink.push({ endpoint: sub.endpoint, payload }); return { statusCode: 201 }; }
  } };
})();
function freshSink() { _sink = []; return _sink; }

const SUB = (ep) => ({ endpoint: ep, keys: { p256dh: "k", auth: "a" } });

test("별칭 해석: members에 이름/이메일로 있어도 canonical 구독으로 발송 도달", async () => {
  await withEnvKeys(async () => {
    __resetForTest();
    const s = fakeStore();
    __setStoreForTest(s.ops);
    const sent = freshSink();
    // wife 가 canonical 'wife' 로 구독 + 별칭 [이름 '앵쥬', 이메일 'w@x.com']
    await saveSubscription("wife", SUB("https://push/wife-A"), ["앵쥬", "w@x.com"]);
    // 방 members 에는 wife 가 '이메일' 표기로 들어있음(구식/이름기반 생성)
    const r = await sendChatPush({ members: ["hub", "w@x.com"], senderId: "hub", title: "t", body: "안녕", roomId: "dm" });
    assert.equal(r.sent, 1, "이메일 표기 멤버 → 별칭으로 canonical 구독 발송");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint, "https://push/wife-A");
    __resetForTest();
  });
});

test("발신자 자기수신 제외 + endpoint 중복 발송 방지", async () => {
  await withEnvKeys(async () => {
    __resetForTest();
    const s = fakeStore();
    __setStoreForTest(s.ops);
    const sent = freshSink();
    // 같은 구독이 두 식별자(canonical + 이메일 별칭)로 도달 가능하지만 endpoint 로 1회만
    await saveSubscription("wife", SUB("https://push/wife-A"), ["w@x.com"]);
    await saveSubscription("hub", SUB("https://push/hub-A"), []);
    // 발신자 hub, 멤버에 hub 자신 + wife 를 canonical과 이메일 둘 다(중복 유발 시도)
    const r = await sendChatPush({ members: ["hub", "wife", "w@x.com"], senderId: "hub", title: "t", body: "hi", roomId: "dm" });
    assert.equal(r.sent, 1, "wife 1회만(중복 endpoint 제거), hub(발신자) 제외");
    assert.deepEqual(sent.map((x) => x.endpoint), ["https://push/wife-A"]);
    __resetForTest();
  });
});

test("구독 없는 대상: 발송 0(조용히 크래시 없음)", async () => {
  await withEnvKeys(async () => {
    __resetForTest();
    __setStoreForTest(fakeStore().ops);
    freshSink();
    const r = await sendChatPush({ members: ["hub", "ghost"], senderId: "hub", title: "t", body: "x", roomId: "dm" });
    assert.equal(r.sent, 0);
    __resetForTest();
  });
});
