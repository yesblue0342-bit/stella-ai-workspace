// 방 나가기/목록 로직 테스트 (C3). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLeave, shouldListRoom } from "../lib/room-membership.js";

test("applyLeave: 멤버에서 제외 + left 기록, 다른 멤버는 유지", () => {
  const data = { roomId: "r1", members: ["me", "you"], messages: [{}, {}] };
  const out = applyLeave(data, "me");
  assert.deepEqual(out.members, ["you"], "나간 사람만 제외");
  assert.ok(out.left.includes("me"), "left에 기록");
  assert.notEqual(out.deleted, true, "다른 멤버 남아있으면 방 유지");
  assert.deepEqual(data.members, ["me", "you"], "원본 불변");
});

test("applyLeave: 마지막 멤버가 나가면 방 tombstone", () => {
  const out = applyLeave({ roomId: "r1", members: ["me"] }, "me");
  assert.deepEqual(out.members, []);
  assert.equal(out.deleted, true);
  assert.ok(out.deletedAt);
});

test("applyLeave: 이미 나간 사람 재나가기 멱등", () => {
  const once = applyLeave({ members: ["me", "you"] }, "me");
  const twice = applyLeave(once, "me");
  assert.deepEqual(twice.members, ["you"]);
  assert.equal(twice.left.filter(x => x === "me").length, 1, "left 중복 안 쌓임");
});

test("shouldListRoom: 나간 사람에겐 안 보이고, 남은 사람에겐 보임 (부활 방지)", () => {
  const left = applyLeave({ roomId: "r1", members: ["me", "you"] }, "me");
  assert.equal(shouldListRoom(left, "me"), false, "나간 me에겐 목록에서 제외 → 재동기화로 부활 안 함");
  assert.equal(shouldListRoom(left, "you"), true, "남은 you에겐 계속 보임");
});

test("shouldListRoom: soft-deleted 방은 누구에게도 안 보임", () => {
  const dead = applyLeave({ members: ["me"] }, "me"); // 마지막 멤버 → deleted
  assert.equal(shouldListRoom(dead, "me"), false);
  assert.equal(shouldListRoom(dead, "other"), false);
});

test("shouldListRoom: 멤버면 보임, 비멤버면 숨김", () => {
  const room = { members: ["a", "b"] };
  assert.equal(shouldListRoom(room, "a"), true);
  assert.equal(shouldListRoom(room, "c"), false);
  assert.equal(shouldListRoom(room, ""), true, "userId 없으면 전체 노출");
});
