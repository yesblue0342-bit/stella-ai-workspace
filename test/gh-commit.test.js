// GitHub 커밋 헬퍼 테스트 (PART B). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ymdKST, sanitizeSeg, outputPath, commitMessage, ghPutFile } from "../lib/gh-commit.mjs";

test("ymdKST: KST 자정 경계", () => {
  assert.equal(ymdKST(new Date("2026-06-17T15:00:00Z")), "20260618");
  assert.equal(ymdKST(new Date("2026-06-17T14:59:59Z")), "20260617");
});

test("outputPath: 규칙 경로 + 안전화", () => {
  assert.equal(outputPath("20260618", "내 세션", "a.py"),
    "stella-agent-output/20260618/내 세션/a.py");
  assert.equal(outputPath("20260618", 'bad/title:*?', "x.js"),
    "stella-agent-output/20260618/bad_title___/x.js");
});

test("commitMessage: 형식", () => {
  assert.equal(commitMessage("20260618", "fib", 3), "[20260618] cc fib - 3 files");
});

test("ghPutFile: 토큰 없으면 NO_TOKEN", async () => {
  await assert.rejects(() => ghPutFile({ repo: "o/r", branch: "main", path: "p", content: "c", message: "m" }),
    (e) => e.code === "NO_TOKEN");
});

test("ghPutFile: 신규 생성(GET 404 → PUT) — 토큰 미노출", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    if ((opts == null || opts.method == null)) return { status: 404, json: async () => ({}) }; // GET sha 없음
    return { ok: true, status: 201, json: async () => ({ content: { sha: "S1", html_url: "https://gh/x" }, commit: { sha: "C1" } }) };
  };
  const out = await ghPutFile({ repo: "o/r", branch: "main", path: "dir/a.py", content: "print(1)", message: "m", token: "SECRET123" }, fakeFetch);
  assert.equal(out.commit, "C1");
  assert.equal(out.htmlUrl, "https://gh/x");
  // PUT 바디에 토큰이 들어가지 않음(헤더로만), 반환값 어디에도 토큰 없음
  const put = calls.find(c => c.opts && c.opts.method === "PUT");
  assert.ok(!String(put.opts.body).includes("SECRET123"), "본문에 토큰 없음");
  assert.ok(!JSON.stringify(out).includes("SECRET123"), "반환값에 토큰 없음");
});

test("ghPutFile: 기존 파일이면 sha 포함 update", async () => {
  let putBody = null;
  const fakeFetch = async (url, opts) => {
    if (opts == null || opts.method == null) return { status: 200, json: async () => ({ sha: "OLD" }) };
    putBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ content: { sha: "NEW" }, commit: { sha: "C2" } }) };
  };
  await ghPutFile({ repo: "o/r", branch: "main", path: "a.py", content: "x", message: "m", token: "T" }, fakeFetch);
  assert.equal(putBody.sha, "OLD", "update 시 기존 sha 포함");
});
