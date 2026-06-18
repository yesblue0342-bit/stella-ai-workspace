// 친구 시스템 테스트 (PART B). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import "../lib/friends.js";
const F = globalThis.StellaFriends;

test("addFriend: 추가한 사용자만 목록에 존재 (B2 미추가자 비노출)", () => {
  let list = [];
  list = F.addFriend(list, { id: "alice", name: "앨리스" });
  assert.equal(list.length, 1);
  assert.equal(F.isFriend(list, "alice"), true);
  assert.equal(F.isFriend(list, "bob"), false, "추가 안 한 bob은 목록에 없음");
});

test("addFriend: id 기준 dedupe (중복 추가 방지), 이름 갱신·addedAt 보존", () => {
  let list = F.addFriend([], { id: "alice", name: "앨리스", addedAt: 100 });
  list = F.addFriend(list, { id: "alice", name: "앨리스2" });
  assert.equal(list.length, 1, "중복 안 쌓임");
  assert.equal(list[0].name, "앨리스2", "이름 갱신");
  assert.equal(list[0].addedAt, 100, "최초 추가시각 보존");
});

test("normalizeFriend: 표시 이름 = 가입자명, 이름 없으면 id", () => {
  assert.equal(F.normalizeFriend({ id: "u1", name: "홍길동" }).name, "홍길동");
  assert.equal(F.normalizeFriend({ id: "u2" }).name, "u2");
  assert.equal(F.normalizeFriend({}), null, "id 없으면 무효");
});

test("removeFriend / visibleFriends 정렬", () => {
  let list = [];
  ["charlie", "alice", "bob"].forEach((id, i) => { list = F.addFriend(list, { id, name: id }); });
  list = F.removeFriend(list, "bob");
  assert.equal(F.isFriend(list, "bob"), false);
  const names = F.visibleFriends(list).map(f => f.name);
  assert.deepEqual(names, ["alice", "charlie"], "이름 오름차순");
});

test("normalizeProfile: 표시 이름 기본=가입자명 (B3)", () => {
  assert.equal(F.normalizeProfile({}, "김가입").name, "김가입");
  assert.equal(F.normalizeProfile({ name: "별명" }, "김가입").name, "별명");
  assert.equal(F.normalizeProfile({ avatar: "data:..." }, "김가입").avatar, "data:...");
});
