// lib/chat/context.mjs · github-actions.mjs — 컨텍스트 조립/액션 라우팅 테스트(네트워크 없이).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDriveReadSummary } from "../lib/chat/context.mjs";
import { selfBase, runGitHubIntent } from "../lib/chat/github-actions.mjs";

test("buildDriveReadSummary: 컨텍스트가 없으면 null", () => {
  assert.equal(buildDriveReadSummary(null), null);
});

test("buildDriveReadSummary: 파일/폴더별 Drive 링크를 생성", () => {
  const out = buildDriveReadSummary({
    path: "StellaGPT > QM008",
    files: [
      { id: "f1", name: "spec.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", read: true },
      { id: "d1", name: "sub", mimeType: "application/vnd.google-apps.folder", read: false, error: "폴더는 파일 내용이 없습니다." },
      { id: "f2", name: "keep.txt", read: true, link: "https://example.com/preset" },
    ],
  });
  assert.equal(out.path, "StellaGPT > QM008");
  assert.equal(out.files[0].link, "https://drive.google.com/file/d/f1/view");
  assert.equal(out.files[1].link, "https://drive.google.com/drive/folders/d1");
  assert.equal(out.files[2].link, "https://example.com/preset", "이미 링크가 있으면 보존");
  assert.equal(out.files[1].error, "폴더는 파일 내용이 없습니다.");
  assert.equal(out.files[0].read, true);
});

test("buildDriveReadSummary: id 없는 항목은 빈 링크", () => {
  const out = buildDriveReadSummary({ path: "p", files: [{ name: "x" }] });
  assert.equal(out.files[0].link, "");
  assert.equal(out.files[0].read, false);
});

test("selfBase: PORT 기본 8970, PUBLIC_BASE_URL 우선 + 끝 슬래시 제거", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  assert.match(selfBase(), /^http:\/\/127\.0\.0\.1:\d+$/);
  process.env.PUBLIC_BASE_URL = "https://stella.example.com///";
  assert.equal(selfBase(), "https://stella.example.com");
  if (prev === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = prev;
});

test("runGitHubIntent: 의도 없음/미구현 타입은 null (AI 폴백)", async () => {
  assert.equal(await runGitHubIntent(null), null);
  assert.equal(await runGitHubIntent({ type: "update_intent", path: "index.html" }), null);
});

test("runGitHubIntent: read 는 앞 500자 미리보기를 코드블록으로 반환", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ content: "x".repeat(900) }) });
  try {
    const out = await runGitHubIntent({ type: "read", path: "index.html" });
    assert.ok(out.includes("📄 **index.html**"));
    assert.ok(out.includes("x".repeat(500)) && !out.includes("x".repeat(501)));
  } finally { globalThis.fetch = realFetch; }
});

test("runGitHubIntent: 호출이 실패하면 던지지 않고 null → AI 폴백", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    assert.equal(await runGitHubIntent({ type: "github_status" }), null);
  } finally { globalThis.fetch = realFetch; }
});
