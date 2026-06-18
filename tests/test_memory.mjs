// tests/test_memory.mjs — 메모리 시스템 스모크(정적/graceful). DB 미보유 환경 가정.
// 모든 엔드포인트가 Azure 미연결에서도 throw 없이 JSON 응답하는지 검증(앱 안정성).
import * as MDB from "../lib/memory-db.mjs";

let pass = 0, fail = 0;
function A(name, ok, extra) { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (ok || !extra ? "" : `  (${extra})`)); }

// 1) memory-db graceful
A("buildMemoryContext → '' (no throw)", (await MDB.buildMemoryContext("u")) === "");
A("searchMemory → []", (await MDB.searchMemory("u")).length === 0);
A("loadProfile → null", (await MDB.loadProfile("u")) === null);
A("saveMemory(no DB) → ok:false (graceful)", (await MDB.saveMemory("u", { memory_text: "x" })).ok === false);
A("saveMemory(빈) → 거절", (await MDB.saveMemory("u", { memory_text: " " })).ok === false);
A("listChatHistory → []", (await MDB.listChatHistory("u")).length === 0);
A("saveChatHistory(no chat_id) → 거절", (await MDB.saveChatHistory("u", {})).ok === false);
A("updateMemory(no id) → 거절", (await MDB.updateMemory("u")).ok === false);

// 2) 엔드포인트 핸들러: DB 없이도 throw 없이 res.json 응답
function mockRes() {
  const r = { _status: 0, _json: null, statusCode: 0 };
  r.status = (n) => { r._status = n; r.statusCode = n; return r; };
  r.json = (o) => { r._json = o; return r; };
  r.setHeader = () => {};
  return r;
}
async function call(modPath, req) {
  const mod = await import(modPath);
  const res = mockRes();
  await mod.default(req, res);
  return res;
}
const cases = [
  ["../api/profile/load.js", { method: "GET", query: { userId: "u" } }],
  ["../api/profile/save.js", { method: "POST", body: { userId: "u", nickname: "kh" } }],
  ["../api/memory/save.js", { method: "POST", body: { userId: "u", memory_text: "SAP PP 컨설턴트" } }],
  ["../api/memory/search.js", { method: "GET", query: { userId: "u", q: "" } }],
  ["../api/memory/update.js", { method: "POST", body: { userId: "u", memory_id: 1, is_active: false } }],
  ["../api/memory/extract.js", { method: "POST", body: { text: "내 직업은 SAP 컨설턴트야 기억해줘" } }],
  ["../api/chat/history.js", { method: "GET", query: { userId: "u" } }],
  ["../api/chat/history.js", { method: "POST", body: { userId: "u", chat_id: "c1", title: "t" } }],
];
for (const [p, req] of cases) {
  let res, threw = null;
  try { res = await call(p, req); } catch (e) { threw = e.message; }
  A(`핸들러 응답(no throw): ${p} [${req.method}]`, !threw && res && res._status >= 200 && res._json && typeof res._json === "object", threw || ("status=" + (res && res._status)));
}

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
