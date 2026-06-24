// 챗 스트리밍(SSE) 클라이언트 테스트. document/fetch 스텁(임시 버블 없이 파싱 로직 검증).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "js", "chat-stream.js"), "utf8");
const win = {};
global.document = { getElementById: () => null }; // 컨테이너 없음 → 버블 미생성
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const stream = win.stellaChatStream;

const enc = (s) => new TextEncoder().encode(s);
function sseRes(chunks, { ct = "text/event-stream", ok = true } = {}) {
  let i = 0;
  return {
    ok, status: ok ? 200 : 500,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? ct : "") },
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc(chunks[i++]) } : { done: true }) }) },
    text: async () => chunks.join(""),
  };
}

test("export 확인", () => assert.equal(typeof stream, "function"));

test("SSE 델타 누적 → 최종 텍스트 반환(streamed:true)", async () => {
  global.fetch = async () => sseRes([
    'data: {"delta":"안녕"}\n\n',
    'data: {"delta":"하세요"}\n\n',
    'data: {"done":true}\n\n',
  ]);
  const r = await stream("/api/chat", { route: true }, {});
  assert.equal(r.streamed, true);
  assert.equal(r.text, "안녕하세요");
});

test("청크가 이벤트 경계를 가로질러도 정확히 파싱", async () => {
  global.fetch = async () => sseRes(['data: {"del', 'ta":"A"}\n\nda', 'ta: {"delta":"B"}\n\n']);
  const r = await stream("/api/chat", {}, {});
  assert.equal(r.text, "AB");
});

test("비-SSE 응답 → NO_STREAM throw(폴백 유도)", async () => {
  global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, body: null, text: async () => "{}" });
  await assert.rejects(() => stream("/api/chat", {}, {}), (e) => e.code === "NO_STREAM");
});

test("빈 스트림(델타 0) → throw(폴백 유도)", async () => {
  global.fetch = async () => sseRes(['data: {"done":true}\n\n']);
  await assert.rejects(() => stream("/api/chat", {}, {}), (e) => e.code === "NO_STREAM");
});

test("에러 이벤트 + 델타 없음 → throw", async () => {
  global.fetch = async () => sseRes(['data: {"error":"boom"}\n\n']);
  await assert.rejects(() => stream("/api/chat", {}, {}));
});
