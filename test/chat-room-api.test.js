/*
 * api/chat-room.js 통합 테스트 — 가짜 Drive I/O + 가짜 req/res 로 핵심 액션 계약 검증.
 *  - send: 방 생성/append + clientId 멱등(재시도 중복 저장 금지) + 비멤버 403
 *  - get: since 증분 필터 + 증분 응답에선 room.messages 제거(페이로드 절감)
 *  - read/list: 읽음 반영 + per-user unread
 *  - leave: 멱등
 */
import test from "node:test";
import assert from "node:assert/strict";
import { __setIoForTest, __resetForTest } from "../lib/chat-store.js";
import handler from "../api/chat-room.js";

function fakeIo(initial = {}) {
  const store = new Map(Object.entries(initial));
  const key = (n) => n.replace(/\.json$/, "");
  return {
    store,
    io: {
      async listIndex() {
        const m = new Map();
        for (const k of store.keys()) m.set(k, { id: "id_" + k, modifiedTime: new Date(0).toISOString() });
        return m;
      },
      async findByName(n) { return store.has(key(n)) ? "id_" + key(n) : null; },
      async read(fileId) {
        const k = fileId.replace(/^id_/, "");
        if (!store.has(k)) throw new Error("not found");
        return JSON.parse(JSON.stringify(store.get(k)));
      },
      async write(n, _id, data) { store.set(key(n), JSON.parse(JSON.stringify(data))); return "id_" + key(n); }
    }
  };
}

function call(query = {}, body = null) {
  const req = { query, body, method: body ? "POST" : "GET" };
  return new Promise((resolve) => {
    const res = {
      _status: 200,
      status(c) { this._status = c; return this; },
      json(payload) { resolve({ status: this._status, body: payload }); return this; }
    };
    handler(req, res);
  });
}

test("chat-room API: send→get→read→list 왕복 + clientId 멱등 + 403 + leave 멱등", async () => {
  __resetForTest();
  const fake = fakeIo({});
  __setIoForTest(fake.io);

  // 1) 첫 send → 방 생성
  let r = await call({ action: "send" }, { roomId: "dm_a_b", title: "테스트방", userId: "a", sender: "a", message: "안녕", members: ["a", "b"], clientId: "c1" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.messageCount, 1);
  const firstId = r.body.message.id;

  // 2) 같은 clientId 재전송(클라 백오프 재시도) → 중복 저장 없음 + 같은 메시지 에코
  r = await call({ action: "send" }, { roomId: "dm_a_b", userId: "a", sender: "a", message: "안녕", members: ["a", "b"], clientId: "c1" });
  assert.equal(r.body.messageCount, 1, "clientId 멱등: 중복 저장 금지");
  assert.equal(r.body.message.id, firstId);

  // 3) 비멤버 전송 차단
  r = await call({ action: "send" }, { roomId: "dm_a_b", userId: "intruder", sender: "x", message: "침입", members: ["intruder"] });
  assert.equal(r.status, 403);

  // 4) get 전체 + get since 증분(room.messages 제거)
  r = await call({ action: "get", roomId: "dm_a_b", userId: "a" });
  assert.equal(r.body.messages.length, 1);
  assert.ok(Array.isArray(r.body.room.messages), "전체 조회는 room.messages 유지(레거시 호환)");
  const lastAt = r.body.lastMessageAt;
  r = await call({ action: "get", roomId: "dm_a_b", userId: "a", since: String(lastAt) });
  assert.equal(r.body.messages.length, 0, "since 이후 새 메시지 없음");
  assert.equal(r.body.room.messages, undefined, "증분 응답은 room.messages 제거(페이로드 절감)");

  // 5) b가 아직 안 읽음 → list unread=1, 읽고 나면 0
  r = await call({ action: "list", userId: "b" });
  assert.equal(r.body.rooms.length, 1);
  assert.equal(r.body.rooms[0].unread, 1);
  assert.equal(r.body.rooms[0].lastMessage, "안녕");
  await call({ action: "read" }, { roomId: "dm_a_b", userId: "b" });
  r = await call({ action: "list", userId: "b" });
  assert.equal(r.body.rooms[0].unread, 0, "읽음 후 unread 0");

  // 6) typing: 기록/조회 (Drive 미사용 — 메모리)
  await call({ action: "typing" }, { roomId: "dm_a_b", userId: "b", typing: true });
  r = await call({ action: "get", roomId: "dm_a_b", userId: "a" });
  assert.ok(r.body.typing.b, "상대 타이핑 표시");

  // 7) leave 멱등 (없는 방도 ok)
  r = await call({ action: "leave" }, { roomId: "no_such_room", userId: "a" });
  assert.equal(r.body.ok, true);

  __resetForTest();
});

test("send: createdAt이 잠금 안에서 찍혀 get의 serverTime 커서가 큐 대기 메시지를 건너뛰지 않는다", async () => {
  __resetForTest();
  // 쓰기(=잠금 보유 구간)를 지연시켜, 뒤에 큐잉된 두 번째 전송의 '가시화'가 늦어지는 창을 재현.
  // 이 창에서 get 이 serverTime 커서를 올려도, 잠금 안 createdAt 스탬프면 두 번째 메시지의
  // createdAt 이 그 커서보다 뒤라 다음 증분 get 에 반드시 포함된다(누락 0).
  const store = new Map();
  const key = (n) => n.replace(/\.json$/, "");
  let writeDelay = 0;
  __setIoForTest({
    async listIndex() { const m = new Map(); for (const k of store.keys()) m.set(k, { id: "id_" + k, modifiedTime: new Date(0).toISOString() }); return m; },
    async findByName(n) { return store.has(key(n)) ? "id_" + key(n) : null; },
    async read(id) { const k = id.replace(/^id_/, ""); if (!store.has(k)) throw new Error("nf"); return JSON.parse(JSON.stringify(store.get(k))); },
    async write(n, _i, d) { if (writeDelay) await new Promise((r) => setTimeout(r, writeDelay)); store.set(key(n), JSON.parse(JSON.stringify(d))); return "id_" + key(n); }
  });
  // 방 생성 + A의 커서 확보
  await call({ action: "send" }, { roomId: "rk", userId: "a", sender: "a", message: "first", members: ["a", "b"], clientId: "c0" });
  let g = await call({ action: "get", roomId: "rk", userId: "a" });
  const cursor = g.body.serverTime;

  // X 전송: 잠금을 80ms 보유(느린 write). Y 전송은 그 뒤에 큐잉 → Y의 createdAt 스탬프가 지연됨.
  writeDelay = 80;
  const pX = call({ action: "send" }, { roomId: "rk", userId: "a", sender: "a", message: "X", members: ["a", "b"], clientId: "cX" });
  await new Promise((r) => setTimeout(r, 10));
  const pY = call({ action: "send" }, { roomId: "rk", userId: "b", sender: "b", message: "Y", members: ["a", "b"], clientId: "cY" });
  await new Promise((r) => setTimeout(r, 10));
  // 이 시점: X는 가시화(잠금 안 persist), Y는 아직 잠금 대기 → Y.createdAt 미스탬프.
  // A의 증분 get: X만 받고 커서를 serverTime 으로 전진.
  g = await call({ action: "get", roomId: "rk", userId: "a", since: String(cursor) });
  const advanced = g.body.serverTime;
  await pX; await pY;
  // 다음 증분 get(since=advanced): Y 가 반드시 포함되어야 함(잠금 밖 스탬프였다면 영원히 누락됐을 것).
  g = await call({ action: "get", roomId: "rk", userId: "a", since: String(advanced) });
  const texts = g.body.messages.map((m) => m.message);
  assert.ok(texts.includes("Y"), "잠금 안 createdAt 로 커서가 큐 대기 메시지 Y를 건너뛰지 않음");
  __resetForTest();
});

test("read: 일시적 Drive 읽기 오류가 다른 사용자의 읽음 기록을 파괴하지 않는다", async () => {
  __resetForTest();
  const store = new Map();
  const key = (n) => n.replace(/\.json$/, "");
  // 기존 __meta: a,b 모두 읽음 기록 있음
  store.set("rm", { roomId: "rm", members: ["a", "b", "c"], messages: [] });
  store.set("rm__meta", { type: "memberChatMeta", roomId: "rm", reads: { a: 1000, b: 2000 } });
  let failMetaRead = true;
  __setIoForTest({
    async listIndex() { const m = new Map(); for (const k of store.keys()) m.set(k, { id: "id_" + k, modifiedTime: new Date(0).toISOString() }); return m; },
    async findByName(n) { return store.has(key(n)) ? "id_" + key(n) : null; },
    async read(id) {
      const k = id.replace(/^id_/, "");
      if (k === "rm__meta" && failMetaRead) throw Object.assign(new Error("quota"), { code: 429 });
      if (!store.has(k)) throw new Error("nf");
      return JSON.parse(JSON.stringify(store.get(k)));
    },
    async write(n, _i, d) { store.set(key(n), JSON.parse(JSON.stringify(d))); return "id_" + key(n); }
  });
  // c가 읽음 처리 — meta 읽기가 실패하는 동안엔 파괴적 flush 가 일어나면 안 됨
  await call({ action: "read" }, { roomId: "rm", userId: "c" });
  await new Promise((r) => setTimeout(r, 30));
  // __meta 파일이 {c만} 으로 덮어써지지 않았는지 확인 (a,b 보존)
  const meta = store.get("rm__meta");
  assert.equal(meta.reads.a, 1000, "a의 읽음 기록 보존");
  assert.equal(meta.reads.b, 2000, "b의 읽음 기록 보존");
  __resetForTest();
});
