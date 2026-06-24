// 챗 fetch 재시도 래퍼 테스트. (window.stellaFetchRetry 추출, global fetch 목)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "js", "fetch-retry.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const sfr = win.stellaFetchRetry;

function mockFetch(seq) {
  let i = 0;
  return async function () { const v = seq[Math.min(i, seq.length - 1)]; i++; if (v instanceof Error) throw v; return { status: v, ok: v >= 200 && v < 300 }; };
}

test("export 확인", () => assert.equal(typeof sfr, "function"));

test("첫 시도 200 → 1회 호출, 그대로 반환", async () => {
  let calls = 0; global.fetch = async () => { calls++; return { status: 200, ok: true }; };
  const r = await sfr("/x", { method: "POST" }, { retries: 2 });
  assert.equal(r.status, 200); assert.equal(calls, 1);
});

test("500 → 재시도 후 200", async () => {
  global.fetch = mockFetch([500, 200]);
  const r = await sfr("/x", {}, { retries: 2 });
  assert.equal(r.status, 200);
});

test("네트워크 오류 → 재시도 후 200", async () => {
  global.fetch = mockFetch([new TypeError("Failed to fetch"), 200]);
  const r = await sfr("/x", {}, { retries: 2 });
  assert.equal(r.status, 200);
});

test("4xx는 재시도 없이 즉시 반환", async () => {
  let calls = 0; global.fetch = async () => { calls++; return { status: 403, ok: false }; };
  const r = await sfr("/x", {}, { retries: 2 });
  assert.equal(r.status, 403); assert.equal(calls, 1);
});

test("재시도 소진 → throw", async () => {
  global.fetch = mockFetch([new TypeError("Failed to fetch")]);
  await assert.rejects(() => sfr("/x", {}, { retries: 1 }));
});

test("timeoutMs 초과 → TimeoutError throw", async () => {
  global.fetch = async (url, opt) => new Promise((_, rej) => { opt.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
  await assert.rejects(() => sfr("/x", {}, { retries: 0, timeoutMs: 50 }), (e) => e.name === "TimeoutError");
});
