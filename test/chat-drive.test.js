// lib/chat/chat-drive.mjs 단위 테스트 — 저장 위치 규칙 + 레거시 이전(마이그레이션) 계약.
//
// 검증:
//  1) 경로 규칙: 채팅은 users/{uid}/chats 하위, 레거시는 chatgpt/chats/{uid}.
//  2) 이전: 레거시 파일을 users/{uid}/chats 로 re-parent(부모만 이동, fileId 불변).
//  3) 멱등: 두 번째 실행은 아무것도 이동하지 않는다(중복 저장 0).
//  4) 중복정리: 신규 위치에 별도 최신본이 있으면 레거시 중복본은 휴지통.
//  5) 드라이런: 어떤 변경도 하지 않는다.
//  6) 레거시 폴더 없음: no-legacy-folder 로 조용히 종료.

import test from "node:test";
import assert from "node:assert/strict";
import {
  safeUser, safeRoom, legacyUser, userChatsPath, legacyChatsPath, chatFileName,
  migrateChatsWithOps,
} from "../lib/chat/chat-drive.mjs";

test("경로 규칙: users/{uid}/chats 하위 + 파일명, 레거시는 chatgpt/chats/{uid}", () => {
  assert.deepEqual(userChatsPath("YesBlue0342"), ["users", "yesblue0342", "chats"]); // 소문자 정규화
  assert.deepEqual(legacyChatsPath("yesblue0342"), ["chatgpt", "chats", "yesblue0342"]);
  assert.equal(chatFileName("r_abc 123!"), "r_abc_123_.json"); // 파일명 안전화
  assert.equal(safeUser("  Foo@Bar.com "), "foo@bar.com");
  assert.equal(safeUser(""), "user");
  assert.equal(safeRoom(""), "room_0");
  assert.equal(legacyUser("홍길동"), "홍길동"); // 한글 허용(레거시 규칙)
});

// 인메모리 fake ops — Drive 없이 이전 오케스트레이션을 그대로 구동.
function makeFakeOps(spec) {
  // spec: { legacy: {id, users:[{id,name,files:[{id,name}]}]} | null, dest: { [folderName]: {id, files:[{id,name}]} } }
  const dest = spec.dest || {};
  const calls = { reparent: [], trash: [], ensure: [] };
  const findLegacyUser = (fid) => (spec.legacy?.users || []).find((u) => u.id === fid);
  const findDestById = (did) => Object.values(dest).find((d) => d.id === did);
  const ops = {
    async legacyRoot() { return spec.legacy ? { id: spec.legacy.id } : null; },
    async listUserFolders() { return (spec.legacy?.users || []).map((u) => ({ id: u.id, name: u.name })); },
    async listJsonFiles(folderId) { const u = findLegacyUser(folderId); return (u ? u.files : []).map((f) => ({ ...f })); },
    async ensureDest(name) { calls.ensure.push(name); dest[name] = dest[name] || { id: "dest_" + name, files: [] }; return { id: dest[name].id }; },
    async findByName(destId, name) { const d = findDestById(destId); const f = d && d.files.find((x) => x.name === name); return f ? { id: f.id, name: f.name } : null; },
    async reparent(fileId, fromId, toId) {
      calls.reparent.push({ fileId, fromId, toId });
      const u = findLegacyUser(fromId); const i = u.files.findIndex((f) => f.id === fileId);
      const [f] = u.files.splice(i, 1); findDestById(toId).files.push(f);
    },
    async trash(fileId) {
      calls.trash.push(fileId);
      for (const u of (spec.legacy?.users || [])) { const i = u.files.findIndex((f) => f.id === fileId); if (i >= 0) u.files.splice(i, 1); }
    },
  };
  return { ops, calls, spec, dest };
}

test("이전: 레거시 파일을 users/{uid}/chats 로 re-parent(부모만 이동)", async () => {
  const fake = makeFakeOps({
    legacy: { id: "L", users: [{ id: "u_yes", name: "yesblue0342", files: [{ id: "f1", name: "r_a.json" }, { id: "f2", name: "r_b.json" }] }] },
    dest: {},
  });
  const r = await migrateChatsWithOps(fake.ops);
  assert.equal(r.moved, 2, "2개 이동");
  assert.equal(r.deduped, 0);
  assert.equal(r.errors, 0);
  assert.equal(fake.calls.reparent.length, 2, "reparent 2회(복사 아님)");
  assert.equal(fake.dest["yesblue0342"].files.length, 2, "목적지에 2개 도착");
  assert.equal(fake.spec.legacy.users[0].files.length, 0, "레거시에서 빠짐(중복 0)");
});

test("멱등: 이미 이전된 파일은 두 번째 실행에서 이동 0(skip)", async () => {
  const fake = makeFakeOps({
    legacy: { id: "L", users: [{ id: "u1", name: "kh", files: [{ id: "f1", name: "r_a.json" }] }] },
    dest: {},
  });
  await migrateChatsWithOps(fake.ops);
  // 두 번째 실행 전, 레거시엔 파일이 없지만(이미 이동) — 다시 돌려도 안전.
  const r2 = await migrateChatsWithOps(fake.ops);
  assert.equal(r2.moved, 0, "두 번째엔 이동 0");
  assert.equal(r2.deduped, 0);
});

test("멱등(양쪽 부모 케이스): 목적지 동일 fileId 존재 시 skip", async () => {
  const fake = makeFakeOps({
    legacy: { id: "L", users: [{ id: "u1", name: "kh", files: [{ id: "fX", name: "r_a.json" }] }] },
    dest: { kh: { id: "dest_kh", files: [{ id: "fX", name: "r_a.json" }] } }, // 같은 fileId 이미 목적지에도(멀티 부모)
  });
  const r = await migrateChatsWithOps(fake.ops);
  assert.equal(r.skipped, 1);
  assert.equal(r.moved, 0);
  assert.equal(fake.calls.reparent.length, 0);
});

test("중복정리: 신규 위치에 다른 fileId 최신본 존재 → 레거시 중복본 휴지통", async () => {
  const fake = makeFakeOps({
    legacy: { id: "L", users: [{ id: "u1", name: "kh", files: [{ id: "old", name: "r_a.json" }] }] },
    dest: { kh: { id: "dest_kh", files: [{ id: "new", name: "r_a.json" }] } },
  });
  const r = await migrateChatsWithOps(fake.ops);
  assert.equal(r.deduped, 1, "중복본 1개 정리");
  assert.equal(r.moved, 0);
  assert.deepEqual(fake.calls.trash, ["old"], "레거시 old 만 휴지통");
});

test("드라이런: 어떤 변경도 하지 않는다", async () => {
  const fake = makeFakeOps({
    legacy: { id: "L", users: [{ id: "u1", name: "kh", files: [{ id: "f1", name: "r_a.json" }] }] },
    dest: {},
  });
  const r = await migrateChatsWithOps(fake.ops, { dryRun: true });
  assert.equal(r.moved, 1, "이동 예정 카운트는 1");
  assert.equal(fake.calls.reparent.length, 0, "실제 reparent 0");
  assert.equal(fake.spec.legacy.users[0].files.length, 1, "레거시 파일 그대로");
});

test("레거시 폴더 없음: no-legacy-folder 로 종료", async () => {
  const fake = makeFakeOps({ legacy: null, dest: {} });
  const r = await migrateChatsWithOps(fake.ops);
  assert.equal(r.reason, "no-legacy-folder");
  assert.equal(r.moved, 0);
});
