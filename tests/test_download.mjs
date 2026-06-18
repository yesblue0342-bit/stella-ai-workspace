// tests/test_download.mjs — api/download.js 핸들러 검증 (fetch 모킹, node로 실행)
import { Readable, Writable } from "node:stream";

process.env.__TEST_TOKEN__ = "test-token"; // getAccessToken 분기 (실인증 안 탐)
const { default: handler, buildContentDisposition } = await import("../api/download.js");

let pass = 0, fail = 0;
function A(name, ok, extra) {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (ok || !extra ? "" : `  (${extra})`));
}

function webStreamFromBuffer(buf) {
  return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } });
}
// meta/media 응답 모킹
function mockFetch(meta, mediaBuf, opts = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes("alt=media")) {
      if (opts.mediaFail) return { ok: false, status: 502, body: null };
      return { ok: true, status: 200, body: webStreamFromBuffer(mediaBuf) };
    }
    if (opts.metaStatus && opts.metaStatus !== 200)
      return { ok: false, status: opts.metaStatus, json: async () => ({ error: "x" }) };
    return { ok: true, status: 200, json: async () => meta };
  };
}
function makeRes() {
  const chunks = [];
  const res = new Writable({ write(ch, enc, cb) { chunks.push(Buffer.from(ch)); cb(); } });
  res.headers = {}; res.statusCode = 0; res.headersSent = false; res._json = null;
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (n) => { res.statusCode = n; res.headersSent = true; return res; };
  res.json = (o) => { res._json = o; res.headersSent = true; res.emit("jsondone"); return res; };
  res.getBody = () => Buffer.concat(chunks);
  return res;
}
async function run(req) {
  const res = makeRes();
  const done = new Promise((resolve) => {
    res.on("finish", () => resolve("stream"));
    res.on("jsondone", () => resolve("json"));
  });
  await handler(req, res);
  await Promise.race([done, new Promise((r) => setTimeout(() => r("timeout"), 2000))]);
  return res;
}

// ── 1) 한글 파일 정상 다운로드 ──
{
  const han = Buffer.from("한글 파일 내용 바이트 스트림", "utf8");
  globalThis.fetch = mockFetch({ name: "참고 자료.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: String(han.length) }, han);
  const r = await run({ query: { fileId: "F1" }, body: {} });
  A("한글 status 200", r.statusCode === 200, "status=" + r.statusCode);
  A("Content-Disposition attachment 세팅", /attachment/.test(r.getHeader("Content-Disposition") || ""));
  A("CD filename* UTF-8 포함", /filename\*=UTF-8''/.test(r.getHeader("Content-Disposition") || ""));
  A("mimeType(Content-Type) 전달", String(r.getHeader("Content-Type") || "").includes("openxmlformats"));
  A("Cache-Control no-store", r.getHeader("Cache-Control") === "no-store");
  A("바이트 일치", r.getBody().equals(han), "len=" + r.getBody().length);
}
// ── 2) zip Content-Length 정확 + 전량 스트리밍 ──
{
  const zip = Buffer.alloc(3300000, 7);
  globalThis.fetch = mockFetch({ name: "data.zip", mimeType: "application/zip", size: "3300000" }, zip);
  const r = await run({ query: { fileId: "Z1" }, body: {} });
  A("zip Content-Length 정확(3300000)", String(r.getHeader("Content-Length")) === "3300000");
  A("zip 바이트 전량 스트리밍", r.getBody().length === 3300000, "len=" + r.getBody().length);
}
// ── 3) 42MB 대용량 전량 일치 ──
{
  const big = Buffer.alloc(42 * 1024 * 1024, 9);
  globalThis.fetch = mockFetch({ name: "big.bin", mimeType: "application/octet-stream", size: String(big.length) }, big);
  const r = await run({ query: { fileId: "B1" }, body: {} });
  A("42MB status 200", r.statusCode === 200);
  A("42MB 바이트 전량 일치(스트리밍 완주)", r.getBody().length === big.length && r.getBody().equals(big), "len=" + r.getBody().length);
}
// ── 4) 구글 네이티브 415 ──
{
  globalThis.fetch = mockFetch({ name: "문서", mimeType: "application/vnd.google-apps.document", size: "0" }, Buffer.alloc(0));
  const r = await run({ query: { fileId: "G1" }, body: {} });
  A("구글네이티브 415", r.statusCode === 415, "status=" + r.statusCode);
}
// ── 5) fileId 누락 400 ──
{
  const r = await run({ query: {}, body: {} });
  A("fileId 누락 400", r.statusCode === 400, "status=" + r.statusCode);
}
// ── 6) 존재하지 않음 404 (meta !ok) ──
{
  globalThis.fetch = mockFetch(null, Buffer.alloc(0), { metaStatus: 404 });
  const r = await run({ query: { fileId: "X" }, body: {} });
  A("존재X 404", r.statusCode === 404, "status=" + r.statusCode);
}
// ── 7) 미디어 실패 502 ──
{
  globalThis.fetch = mockFetch({ name: "f", mimeType: "application/octet-stream", size: "10" }, Buffer.alloc(0), { mediaFail: true });
  const r = await run({ query: { fileId: "M" }, body: {} });
  A("미디어 실패 502", r.statusCode === 502, "status=" + r.statusCode);
}
// ── 8) buildContentDisposition 직접 검증 ──
{
  const cd = buildContentDisposition("참고 자료.xlsx");
  A("buildCD filename* UTF-8 인코딩", cd.includes("filename*=UTF-8''") && cd.includes(encodeURIComponent("참고 자료.xlsx")));
  const m = /filename="([^"]*)"/.exec(cd);
  A("buildCD ASCII fallback에 비ASCII 없음", !!m && !/[^\x00-\x7F]/.test(m[1]), m ? m[1] : "(no match)");
}

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
