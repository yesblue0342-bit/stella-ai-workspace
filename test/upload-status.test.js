// test/upload-status.test.js — drive-manage action=upload-status (서버측 resumable 완료 검증).
// 실제 네트워크 없이 global.fetch 를 스텁하여 SSRF 가드 + 상태 매핑을 검증. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/drive-manage.js";

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  return r;
}
async function call(body, fetchImpl) {
  const orig = global.fetch;
  global.fetch = fetchImpl;
  try {
    const req = { method: "POST", query: { action: "upload-status" }, body };
    const res = mockRes();
    await handler(req, res);
    return res;
  } finally { global.fetch = orig; }
}
const GOOG = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=ABC";

test("SSRF 가드: 구글이 아닌 uploadUrl 거부 (서버가 임의 URL로 PUT하지 않음)", async () => {
  let fetched = false;
  const res = await call({ uploadUrl: "https://evil.example.com/x", fileSize: 10 }, async () => { fetched = true; return {}; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(fetched, false, "거부된 URL은 fetch조차 하지 않아야 함");
});

test("uploadUrl 누락 → 400", async () => {
  const res = await call({ fileSize: 100 }, async () => { throw new Error("no"); });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test("200 → complete (fileId/name 표면화)", async () => {
  const res = await call({ uploadUrl: GOOG, fileSize: 100 },
    async () => ({ status: 200, json: async () => ({ id: "FID", name: "a.xlsx", size: "100" }), text: async () => "" }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, "complete");
  assert.equal(res.body.fileId, "FID");
  assert.equal(res.body.name, "a.xlsx");
});

test("308 → incomplete (Range 헤더로 수신 바이트 계산)", async () => {
  const res = await call({ uploadUrl: GOOG, fileSize: 100 },
    async () => ({ status: 308, headers: { get: (h) => (h.toLowerCase() === "range" ? "bytes=0-49" : null) }, text: async () => "" }));
  assert.equal(res.body.status, "incomplete");
  assert.equal(res.body.received, 50);
});

test("404 → gone (세션 만료/소멸)", async () => {
  const res = await call({ uploadUrl: GOOG, fileSize: 100 },
    async () => ({ status: 404, headers: { get: () => null }, text: async () => "not found" }));
  assert.equal(res.body.status, "gone");
  assert.equal(res.body.httpStatus, 404);
});

test("complete 시 JSON 파싱 실패해도 ok (fileId=null)", async () => {
  const res = await call({ uploadUrl: GOOG, fileSize: 100 },
    async () => ({ status: 201, json: async () => { throw new Error("bad json"); }, text: async () => "" }));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, "complete");
  assert.equal(res.body.fileId, null);
});
