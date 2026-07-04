// lib/codex-workspace.mjs 단위 테스트 — 경로 탈출/민감파일 차단 + 파일 read/write/delete/list.
// git clone/push는 네트워크가 필요해 이 테스트에서 다루지 않는다(수동 mkdtemp로 워크스페이스만 흉내).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeRelPath, listDir, readFileRel, writeFileRel, deleteFileRel } from "../lib/codex-workspace.mjs";

async function makeFakeRepo() {
  const base = await mkdtemp(join(tmpdir(), "codex-ws-test-"));
  const root = join(base, "repo");
  await mkdir(root, { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, ".git", "config"), "[fake]\ntoken=SHOULD_NOT_BE_READABLE\n");
  await writeFile(join(root, ".env"), "SECRET=abc");
  await writeFile(join(root, "README.md"), "# hi\n");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.js"), "console.log(1)");
  return { root, base, branch: "main" };
}

test("safeRelPath: 정상 상대경로는 워크스페이스 내부로 resolve", () => {
  const abs = safeRelPath("/tmp/ws", "src/a.js");
  assert.equal(abs, "/tmp/ws/src/a.js");
});

test("safeRelPath: '..' 경로 탈출 차단", () => {
  assert.throws(() => safeRelPath("/tmp/ws", "../etc/passwd"), /접근할 수 없는 경로/);
});

test("safeRelPath: .git/ 및 .env 접근 차단", () => {
  assert.throws(() => safeRelPath("/tmp/ws", ".git/config"), /접근할 수 없는 경로/);
  assert.throws(() => safeRelPath("/tmp/ws", ".env"), /접근할 수 없는 경로/);
  assert.throws(() => safeRelPath("/tmp/ws", "sub/.env"), /접근할 수 없는 경로/);
});

test("safeRelPath: 절대경로 형태('/etc/passwd')도 선행 슬래시를 제거해 워크스페이스 내부로 안전하게 가둔다", () => {
  // resolve()에 순수 상대경로만 넘기므로 진짜 절대경로 오버라이드가 발생하지 않는다 — 탈출 아님.
  const abs = safeRelPath("/tmp/ws", "/etc/passwd");
  assert.equal(abs, "/tmp/ws/etc/passwd");
});

test("listDir: 루트 목록에 .git 미노출, 파일/디렉터리 정렬", async () => {
  const ws = await makeFakeRepo();
  try {
    const out = await listDir(ws, "");
    assert.ok(!out.includes(".git"));
    assert.match(out, /README\.md/);
    assert.match(out, /src\//);
  } finally { await rm(ws.base, { recursive: true, force: true }); }
});

test("readFileRel: 정상 파일은 읽히고, .git/.env는 차단", async () => {
  const ws = await makeFakeRepo();
  try {
    const content = await readFileRel(ws, "README.md");
    assert.equal(content, "# hi\n");
    await assert.rejects(readFileRel(ws, ".git/config"), /접근할 수 없는 경로/);
    await assert.rejects(readFileRel(ws, ".env"), /접근할 수 없는 경로/);
  } finally { await rm(ws.base, { recursive: true, force: true }); }
});

test("writeFileRel: 상위 디렉터리 자동 생성 후 저장, 이후 read로 확인", async () => {
  const ws = await makeFakeRepo();
  try {
    await writeFileRel(ws, "new/dir/file.txt", "hello");
    const content = await readFileRel(ws, "new/dir/file.txt");
    assert.equal(content, "hello");
  } finally { await rm(ws.base, { recursive: true, force: true }); }
});

test("deleteFileRel: 파일 삭제 후 read 시 404", async () => {
  const ws = await makeFakeRepo();
  try {
    await deleteFileRel(ws, "README.md");
    await assert.rejects(readFileRel(ws, "README.md"), /찾을 수 없습니다/);
  } finally { await rm(ws.base, { recursive: true, force: true }); }
});

test("readFileRel: 존재하지 않는 파일은 404 status", async () => {
  const ws = await makeFakeRepo();
  try {
    await assert.rejects(readFileRel(ws, "nope.txt"), (e) => e.status === 404);
  } finally { await rm(ws.base, { recursive: true, force: true }); }
});
