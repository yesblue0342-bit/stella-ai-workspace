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

// 회귀: 부분 델타가 온 뒤 서버 오류로 끊기면, 잘린 답을 완결처럼 저장하지 않고 중단 표시 + truncated 플래그.
test("부분 델타 후 에러 → 중단 표시 부착 + truncated:true (재요청 안 함)", async () => {
  global.fetch = async () => sseRes([
    'data: {"delta":"앞부분 답변"}\n\n',
    'data: {"error":"stream aborted"}\n\n',
  ]);
  const r = await stream("/api/chat", {}, {});
  assert.equal(r.truncated, true);
  assert.match(r.text, /^앞부분 답변/);
  assert.match(r.text, /중단되어 내용이 잘렸/);
});

// 회귀: 채팅 스트림은 재시도 0·타임아웃 300초로 호출해야 한다(이중 과금·조기 실패 방지).
test("스트림 fetch에 {timeoutMs:300000, retries:0} cfg를 넘긴다", async () => {
  let seenCfg = null;
  win.stellaFetchRetry = async (url, opts, cfg) => { seenCfg = cfg; return sseRes(['data: {"delta":"x"}\n\n','data: {"done":true}\n\n']); };
  await stream("/api/chat", {}, {});
  win.stellaFetchRetry = undefined;
  assert.ok(seenCfg, "cfg가 전달되어야 함");
  assert.equal(seenCfg.retries, 0);
  assert.equal(seenCfg.timeoutMs, 300000);
});
