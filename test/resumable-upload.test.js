// lib/resumable-upload.js 단위 테스트 — 실제 네트워크 없이 가짜 fetch 로 프로토콜 검증.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../lib/resumable-upload.js";
const R = globalThis.StellaResumable;

// ── 순수 헬퍼 ───────────────────────────────────────────────
test("alignChunkSize: 256KB 배수로 내림(최소 256KB)", () => {
  const K = 1024;
  assert.equal(R.alignChunkSize(0), 256 * K);
  assert.equal(R.alignChunkSize(100), 256 * K);
  assert.equal(R.alignChunkSize(256 * K), 256 * K);
  assert.equal(R.alignChunkSize(256 * K + 10), 256 * K);
  assert.equal(R.alignChunkSize(8 * 1024 * 1024 + 5), 8 * 1024 * 1024);
});

test("parseRangeEnd / nextOffsetFromRange", () => {
  assert.equal(R.parseRangeEnd("bytes=0-262143"), 262143);
  assert.equal(R.parseRangeEnd("0-99"), 99);
  assert.equal(R.parseRangeEnd(null), -1);
  assert.equal(R.parseRangeEnd("garbage"), -1);
  assert.equal(R.nextOffsetFromRange("bytes=0-262143"), 262144);
  assert.equal(R.nextOffsetFromRange(null), 0);
});

test("backoffDelay: 1s→2s→4s", () => {
  assert.equal(R.backoffDelay(1, 1000), 1000);
  assert.equal(R.backoffDelay(2, 1000), 2000);
  assert.equal(R.backoffDelay(3, 1000), 4000);
});

test("contentRange / status 분류", () => {
  assert.equal(R.contentRange(0, 256, 1000), "bytes 0-255/1000");
  assert.equal(R.isFinalStatus(200), true);
  assert.equal(R.isFinalStatus(201), true);
  assert.equal(R.isResumeStatus(308), true);
  assert.equal(R.isRetriableStatus(500), true);
  assert.equal(R.isRetriableStatus(429), true);
  assert.equal(R.isRetriableStatus(0), true);
  assert.equal(R.isRetriableStatus(404), false);
});

// ── 가짜 파일/응답 헬퍼 ──────────────────────────────────────
function fakeFile(size, type) {
  return {
    size, type: type || "application/octet-stream",
    // slice 는 [start,end) 메타만 기록(실 바이트 불필요).
    slice(s, e) { return { start: s, end: e, len: e - s }; }
  };
}
function resp(status, headers, json) {
  return {
    status,
    headers: { get: (k) => (headers && headers[k]) || null },
    json: async () => json || {},
    text: async () => JSON.stringify(json || {})
  };
}
const noSleep = async () => {};

// ── 통합: 정상 멀티청크 업로드 ───────────────────────────────
test("resumableUpload: 다중 청크가 순서대로 전송되고 final 응답 반환", async () => {
  const total = 768 * 1024;          // 256KB 청크 3개
  const chunk = 256 * 1024;
  const sent = [];
  let calls = 0;
  const fetchImpl = async (url, opt) => {
    calls++;
    const cr = opt.headers["Content-Range"];
    sent.push(cr);
    // 마지막 청크면 200, 아니면 308+Range
    const m = cr.match(/bytes (\d+)-(\d+)\/(\d+)/);
    const end = Number(m[2]);
    if (end + 1 >= total) return resp(200, {}, { id: "FILE1", size: String(total) });
    return resp(308, { Range: "bytes=0-" + end }, {});
  };
  const meta = await R.resumableUpload("http://up", fakeFile(total), { fetchImpl, sleep: noSleep, chunkSize: chunk });
  assert.equal(meta.id, "FILE1");
  assert.deepEqual(sent, [
    "bytes 0-262143/786432",
    "bytes 262144-524287/786432",
    "bytes 524288-786431/786432"
  ]);
  assert.equal(calls, 3);
});

// ── 통합: 청크 실패 → 백오프 재시도 → 성공 ─────────────────────
test("resumableUpload: 5xx 실패 후 재시도하여 성공(빠진 청크만 재전송)", async () => {
  const total = 512 * 1024;          // 256KB 청크 2개
  const chunk = 256 * 1024;
  let firstChunkAttempts = 0;
  const delays = [];
  const fetchImpl = async (url, opt) => {
    const cr = opt.headers["Content-Range"];
    // 재시도 전 상태 질의(bytes */total)는 308+Range(아직 0바이트) 응답
    if (cr === "bytes */" + total) return resp(308, { Range: null }, {});
    const m = cr.match(/bytes (\d+)-(\d+)\/(\d+)/);
    const start = Number(m[0].match(/bytes (\d+)/)[1] || 0);
    const end = Number(m[2]);
    if (start === 0) {
      firstChunkAttempts++;
      if (firstChunkAttempts === 1) return resp(500, {}, {}); // 첫 시도 실패
      return resp(308, { Range: "bytes=0-" + end }, {});      // 재시도 성공
    }
    return resp(201, {}, { id: "FILE2", size: String(total) }); // 마지막 청크
  };
  const meta = await R.resumableUpload("http://up", fakeFile(total), {
    fetchImpl, sleep: async (ms) => { delays.push(ms); }, chunkSize: chunk, baseDelay: 1000
  });
  assert.equal(meta.id, "FILE2");
  assert.equal(firstChunkAttempts, 2, "첫 청크는 1회 실패+1회 성공 = 2시도");
  assert.deepEqual(delays, [1000], "1회 재시도 → 1초 백오프");
});

// ── 통합: 무결성 — 크기 불일치는 에러 ─────────────────────────
test("resumableUpload: 응답 size 불일치면 무결성 에러", async () => {
  const total = 256 * 1024;
  const fetchImpl = async () => resp(200, {}, { id: "X", size: "999" });
  await assert.rejects(
    R.resumableUpload("http://up", fakeFile(total), { fetchImpl, sleep: noSleep }),
    /크기 불일치/
  );
});

// ── 통합: 4xx 치명적 — 재시도 없이 즉시 실패 ─────────────────
test("resumableUpload: 404 등 4xx 는 재시도 없이 실패", async () => {
  const total = 256 * 1024;
  let calls = 0;
  const fetchImpl = async () => { calls++; return resp(404, {}, { error: "not found" }); };
  await assert.rejects(
    R.resumableUpload("http://up", fakeFile(total), { fetchImpl, sleep: noSleep }),
    /업로드 실패\(status 404\)/
  );
  assert.equal(calls, 1, "4xx 는 단 1회만 호출(재시도 금지)");
});

// ── 통합: 재시도 소진 시 마지막 에러 throw ───────────────────
test("resumableUpload: maxRetries 소진 시 실패", async () => {
  const total = 256 * 1024;
  let calls = 0;
  const fetchImpl = async (url, opt) => {
    calls++;
    if (opt.headers["Content-Range"] === "bytes */" + total) return resp(308, { Range: null }, {});
    return resp(503, {}, {});
  };
  await assert.rejects(
    R.resumableUpload("http://up", fakeFile(total), { fetchImpl, sleep: noSleep, maxRetries: 3, baseDelay: 1 }),
    /일시 오류|재시도 소진/
  );
  // 3회 청크 시도(사이사이 상태질의는 별도) → 청크 PUT 만 3회
  const chunkPuts = calls; // 단일 청크라 전부 동일 url; 최소 3회 이상
  assert.ok(chunkPuts >= 3, "재시도 3회 이상 시도해야");
});
