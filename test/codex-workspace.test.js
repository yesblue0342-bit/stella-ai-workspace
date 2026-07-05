// lib/codex-workspace.mjs 단위 테스트 — 경로 탈출/민감파일 차단 + 파일 read/write/delete/list.
// git clone/push는 네트워크가 필요해 이 테스트에서 다루지 않는다(수동 mkdtemp로 워크스페이스만 흉내).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeRelPath, listDir, readFileRel, writeFileRel, deleteFileRel, scrubSecret, git } from "../lib/codex-workspace.mjs";

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
  // OS 네이티브 절대경로를 root 로 써야 Windows(백슬래시·드라이브레터)에서도 동일하게 검증된다.
  const root = join(tmpdir(), "ws");
  const abs = safeRelPath(root, "src/a.js");
  assert.equal(abs, join(root, "src", "a.js"));
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
  const root = join(tmpdir(), "ws");
  const abs = safeRelPath(root, "/etc/passwd");
  assert.equal(abs, join(root, "etc", "passwd"));
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

// ── 보안 회귀 테스트: git 인증 헤더(토큰의 base64)가 에러 메시지로 절대 노출되지 않아야 한다 ──
// (실사고 재현: /codex 레포 clone 실패 시 "AUTHORIZATION: basic <base64 토큰>"이 사용자 화면에 그대로 노출됐던 사고)
test("scrubSecret: AUTHORIZATION 헤더(base64 토큰)를 마스킹한다", () => {
  const token = "ghp_SUPERSECRETTOKEN1234567890abcdef";
  const b64 = Buffer.from("x-access-token:" + token).toString("base64");
  const raw = `Command failed: git -c http.extraheader=AUTHORIZATION: basic ${b64} clone --depth 1 https://github.com/o/r.git /tmp/x`;
  const scrubbed = scrubSecret(raw);
  assert.ok(!scrubbed.includes(b64), "토큰의 base64 인코딩이 남아있으면 안 됨");
  assert.ok(!scrubbed.includes(token), "토큰 원문이 남아있으면 안 됨");
  assert.match(scrubbed, /AUTHORIZATION: basic \*\*\*/);
});

test("scrubSecret: null/undefined/빈 문자열은 안전하게 빈 문자열로", () => {
  assert.equal(scrubSecret(null), "");
  assert.equal(scrubSecret(undefined), "");
  assert.equal(scrubSecret(""), "");
});

test("git(): 실패해도 토큰(및 base64 인코딩)이 에러 메시지에 절대 포함되지 않는다 — 네트워크 없이 즉시 실패하는 잘못된 옵션으로 재현", async () => {
  const token = "ghp_SUPERSECRETTOKEN1234567890abcdef";
  const b64 = Buffer.from("x-access-token:" + token).toString("base64");
  // "--this-option-does-not-exist"는 git이 네트워크를 타기 전에 즉시 인자 파싱 오류로 실패한다
  // (오프라인·결정적 재현 — 그래도 -c http.extraheader=...는 실제 invoke된 argv에 포함됨).
  await assert.rejects(
    git(process.cwd(), token, ["--this-option-does-not-exist"]),
    (e) => {
      assert.ok(!e.message.includes(token), "토큰 원문 노출 금지: " + e.message);
      assert.ok(!e.message.includes(b64), "토큰 base64 노출 금지: " + e.message);
      assert.ok(!/AUTHORIZATION:\s*basic\s+[A-Za-z0-9+/=]{10,}/i.test(e.message), "인증 헤더 값 자체가 노출되면 안 됨: " + e.message);
      return true;
    }
  );
});

test("git(): 토큰 없이 호출해도 정상 동작(옵트인 인증 — 회귀 없음)", async () => {
  const out = await git(process.cwd(), null, ["--version"]);
  assert.match(out, /git version/);
});
