/*
 * lib/chat-store.js 단위 테스트 — 가짜 Drive I/O 주입으로 동시성/멱등/캐시 계약 검증.
 * 핵심 계약:
 *  1) 동시 전송이 직렬화되어 메시지가 유실되지 않는다 (기존 read-modify-write 유실 사고 방지)
 *  2) 읽기는 캐시 히트 시 Drive 호출 0회 (폴링 쿼터 사고 방지)
 *  3) Drive 쓰기 실패 시 캐시 롤백 (클라 재시도와 일관)
 *  4) typing 은 Drive 를 전혀 건드리지 않는다
 *  5) waitForMessages 는 append 이벤트로 즉시 깨어난다
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  __setIoForTest, __resetForTest,
  loadRoom, mutateRoom, appendMessage, setTyping, getTyping,
  listRoomSummaries, countUnread, waitForMessages
} from "../lib/chat-store.js";

function makeFakeIo(initial = {}) {
  // name(확장자 제거) -> data
  const store = new Map(Object.entries(initial));
  const calls = { list: 0, find: 0, read: 0, write: 0 };
  let failWrites = false;
  const key = (fileName) => fileName.replace(/\.json$/, "");
  return {
    store, calls,
    setFailWrites(v) { failWrites = v; },
    io: {
      async listIndex() {
        calls.list++;
        const m = new Map();
        for (const k of store.keys()) m.set(k, { id: "id_" + k, modifiedTime: new Date(0).toISOString() });
        return m;
      },
      async findByName(fileName) {
        calls.find++;
        return store.has(key(fileName)) ? "id_" + key(fileName) : null;
      },
      async read(fileId) {
        calls.read++;
        const k = fileId.replace(/^id_/, "");
        if (!store.has(k)) throw new Error("not found: " + fileId);
        return JSON.parse(JSON.stringify(store.get(k)));
      },
      async write(fileName, existingFileId, data) {
        calls.write++;
        if (failWrites) { const e = new Error("quota"); e.code = 429; throw e; }
        store.set(key(fileName), JSON.parse(JSON.stringify(data)));
        return "id_" + key(fileName);
      }
    }
  };
}

test("동시 전송 20건이 직렬화되어 전부 보존된다(유실 0)", async () => {
  __resetForTest();
  const fake = makeFakeIo({ r1: { roomId: "r1", members: [], messages: [] } });
  __setIoForTest(fake.io);
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    appendMessage("r1", (cur) => ({
      ...(cur || { roomId: "r1" }),
      messages: [...((cur && cur.messages) || []), { id: "m" + i, createdAt: new Date().toISOString() }]
    }))
  ));
  const data = await loadRoom("r1");
  assert.equal(data.messages.length, 20);
  assert.equal(new Set(data.messages.map((m) => m.id)).size, 20);
  __resetForTest();
});

test("캐시 히트 읽기는 Drive read를 다시 호출하지 않는다", async () => {
  __resetForTest();
  const fake = makeFakeIo({ r2: { roomId: "r2", messages: [{ id: "a", createdAt: new Date().toISOString() }] } });
  __setIoForTest(fake.io);
  await loadRoom("r2");
  const reads = fake.calls.read;
  for (let i = 0; i < 50; i++) await loadRoom("r2");
  assert.equal(fake.calls.read, reads, "50회 재조회에 Drive read 추가 호출 0회");
  __resetForTest();
});

test("Drive 쓰기 실패 시 캐시 롤백 + throw(stage=persist)", async () => {
  __resetForTest();
  const fake = makeFakeIo({ r3: { roomId: "r3", messages: [{ id: "keep", createdAt: new Date().toISOString() }] } });
  __setIoForTest(fake.io);
  await loadRoom("r3");
  fake.setFailWrites(true);
  await assert.rejects(
    mutateRoom("r3", (cur) => ({ ...cur, messages: [...cur.messages, { id: "lost" }] })),
    (e) => e.stage === "persist"
  );
  const data = await loadRoom("r3");
  assert.equal(data.messages.length, 1, "실패한 쓰기가 캐시에 남지 않음");
  assert.equal(data.messages[0].id, "keep");
  __resetForTest();
});

test("typing은 Drive를 전혀 호출하지 않는다", async () => {
  __resetForTest();
  const fake = makeFakeIo({});
  __setIoForTest(fake.io);
  setTyping("r4", "userA", true);
  assert.deepEqual(Object.keys(getTyping("r4")), ["userA"]);
  setTyping("r4", "userA", false);
  assert.deepEqual(Object.keys(getTyping("r4")), []);
  assert.equal(fake.calls.read + fake.calls.write + fake.calls.list + fake.calls.find, 0);
  __resetForTest();
});

test("waitForMessages: append 이벤트로 즉시 깨어난다", async () => {
  __resetForTest();
  const fake = makeFakeIo({ r5: { roomId: "r5", messages: [] } });
  __setIoForTest(fake.io);
  await loadRoom("r5");
  const since = Date.now() - 1;
  const waiter = waitForMessages("r5", since, 5000);
  await new Promise((r) => setTimeout(r, 30));
  await appendMessage("r5", (cur) => ({ ...cur, messages: [...cur.messages, { id: "new", createdAt: new Date().toISOString() }] }));
  const t0 = Date.now();
  const { fresh } = await waiter;
  assert.ok(Date.now() - t0 < 1000, "타임아웃 전에 즉시 반환");
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].id, "new");
  __resetForTest();
});

test("레이스 가드: 느린 캐시 미스 로드가 잠금 쓰기 직후 캐시를 되돌려 메시지를 유실시키지 않는다", async () => {
  __resetForTest();
  const fake = makeFakeIo({ rr: { roomId: "rr", messages: [{ id: "A", createdAt: new Date().toISOString() }] } });
  // io.read 를 게이트로 감싸 '느린 Drive 읽기' 재현
  let releaseRead;
  const gate = new Promise((r) => { releaseRead = r; });
  const origRead = fake.io.read;
  let gated = true;
  fake.io.read = async (fileId) => { const d = await origRead(fileId); if (gated) await gate; return d; };
  __setIoForTest(fake.io);

  // 1) 캐시 미스 GET 폴링이 느린 읽기 시작 (v1=[A] 스냅샷을 물고 대기)
  const slowLoad = loadRoom("rr");
  await new Promise((r) => setTimeout(r, 20));
  // 2) 그 사이 전송 M 이 잠금 안에서 확정(persist → 캐시 최신)
  gated = false; // 잠금 내부의 loadRoom 재로드는 게이트 없이 통과 (in-flight 공유되므로 실제로는 발생 안 함)
  const sendP = appendMessage("rr", (cur) => ({
    ...(cur || { roomId: "rr" }),
    messages: [...((cur && cur.messages) || []), { id: "M", createdAt: new Date().toISOString() }]
  }));
  await new Promise((r) => setTimeout(r, 20));
  // 3) 느린 읽기가 뒤늦게 도착 — 옛 스냅샷 v1 이 캐시를 덮어쓰면 안 됨
  releaseRead();
  await slowLoad;
  await sendP;
  // 4) 다음 전송 N — 유실 없이 [A, M, N] 이어야 함
  const data = await appendMessage("rr", (cur) => ({
    ...cur, messages: [...cur.messages, { id: "N", createdAt: new Date().toISOString() }]
  }));
  assert.deepEqual(data.messages.map((m) => m.id), ["A", "M", "N"], "확정 메시지 M 이 유실되지 않음");
  assert.deepEqual(fake.store.get("rr").messages.map((m) => m.id), ["A", "M", "N"], "Drive 최종본에도 M 보존");
  __resetForTest();
});

test("listRoomSummaries + countUnread: 목록과 사용자별 안읽음", async () => {
  __resetForTest();
  const t = (ms) => new Date(Date.now() + ms).toISOString();
  const fake = makeFakeIo({
    roomA: { roomId: "roomA", members: ["me", "you"], messages: [
      { id: "1", userId: "you", createdAt: t(-1000) },
      { id: "2", userId: "you", createdAt: t(-500) },
      { id: "3", userId: "me", createdAt: t(-100) }
    ] },
    roomA__meta: { type: "memberChatMeta", roomId: "roomA", reads: {} }
  });
  __setIoForTest(fake.io);
  const list = await listRoomSummaries();
  assert.equal(list.length, 1, "__meta 파일은 방 목록에서 제외");
  assert.equal(list[0].roomId, "roomA");
  const unread = countUnread(list[0].data, { me: Date.now() - 700 }, "me");
  assert.equal(unread, 1, "읽은 시각 이후 상대 메시지만 카운트(내 메시지 제외)");
  __resetForTest();
});
