// tests/test_hub.mjs — api/github.js repos/contents 액션 라우팅·매핑 검증 (fetch 모킹, 무과금)
const mod = await import("../api/github.js");
const handler = mod.default;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/user/repos") || u.includes("/users/")) {
    return { ok: true, status: 200, text: async () => JSON.stringify([
      { name: "stella-ai-workspace", full_name: "o/stella-ai-workspace", owner: { login: "o" }, default_branch: "main", private: false, language: "JS", description: "d", stargazers_count: 2, updated_at: "x" },
      { name: "secret-proj", full_name: "o/secret-proj", owner: { login: "o" }, default_branch: "main", private: true, language: "TS", description: "", stargazers_count: 0, updated_at: "y" },
    ]) };
  }
  if (u.includes("/contents/src/a.js")) return { ok: true, status: 200, text: async () => JSON.stringify({ name: "a.js", path: "src/a.js", type: "file", sha: "s", size: 10, encoding: "base64", content: "aGk=" }) };
  if (u.includes("/contents/src")) return { ok: true, status: 200, text: async () => JSON.stringify([{ name: "a.js", path: "src/a.js", type: "file", sha: "s", size: 10 }]) };
  return { ok: false, status: 404, text: async () => JSON.stringify({ message: "nf" }) };
};
function makeRes() { const r = { s: 0, j: null }; r.status = (n) => { r.s = n; return r; }; r.json = (o) => { r.j = o; return r; }; r.setHeader = () => {}; return r; }

let pass = 0, fail = 0;
const A = (n, ok, e) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}` + (ok || !e ? "" : `  (${e})`)); };

let r = makeRes(); await handler({ method: "GET", query: { action: "repos" } }, r);
A("repos: ok + repos 배열(2)", r.j && r.j.ok && Array.isArray(r.j.repos) && r.j.repos.length === 2, JSON.stringify(r.j).slice(0, 80));
A("repos: private 플래그 매핑(공개/비공개 구분)", r.j.repos.find(x => x.name === "secret-proj").private === true && r.j.repos.find(x => x.name === "stella-ai-workspace").private === false);
A("repos: authenticated 필드 존재", typeof r.j.authenticated === "boolean");

r = makeRes(); await handler({ method: "GET", query: { action: "contents", owner: "o", repo: "secret-proj", path: "src" } }, r);
A("contents dir → type=dir + items", r.j.ok && r.j.type === "dir" && r.j.items.length === 1 && r.j.items[0].name === "a.js");

r = makeRes(); await handler({ method: "GET", query: { action: "contents", owner: "o", repo: "secret-proj", path: "src/a.js" } }, r);
A("contents file → type=file + base64 content", r.j.ok && r.j.type === "file" && r.j.content === "aGk=");

r = makeRes(); await handler({ method: "GET", query: { action: "contents" } }, r);
A("contents owner/repo 누락 → 400", r.s === 400);

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
