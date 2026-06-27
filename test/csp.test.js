// CSP/rewrite 테스트 — Vercel 제거 후 OCI 서버(server.mjs)를 기준으로 검증.
// server.mjs 를 import 하면 app.listen 이 떠버리므로, 소스를 텍스트로 읽어 CSP 문자열과
// REWRITES 매핑을 정적 추출해 검사한다(이전엔 vercel.json 을 읽었음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverSrc = readFileSync(fileURLToPath(new URL("../server.mjs", import.meta.url)), "utf8");

// server.mjs 의 CSP 상수(여러 문자열 + 로 이어붙임)를 합쳐 한 줄 CSP 로 복원.
function getCSP() {
  // CSP 문자열 조각들은 내부에 ';' 를 포함하므로, '줄 끝의 ;' 까지를 한 덩어리로 잡는다.
  const m = serverSrc.match(/const CSP\s*=([\s\S]*?);\s*$/m);
  if (!m) return "";
  // 따옴표로 둘러싼 조각들만 추출해 이어붙임.
  const parts = m[1].match(/"([^"]*)"/g) || [];
  return parts.map((s) => s.slice(1, -1)).join("");
}
function directive(csp, name) {
  const m = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + " ") || s === name);
  return m || "";
}
// REWRITES 객체에서 '/path': 'file.html' 매핑 추출.
function getRewrites() {
  const m = serverSrc.match(/const REWRITES\s*=\s*\{([\s\S]*?)\};/);
  if (!m) return {};
  const out = {};
  const re = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  let g;
  while ((g = re.exec(m[1]))) out[g[1]] = g[2];
  return out;
}

test("CSP 헤더가 server.mjs 에 정의됨", () => {
  assert.ok(getCSP().length > 0, "CSP 정의됨");
});

test("script-src에 'unsafe-eval' 없음 (보안 강화)", () => {
  assert.doesNotMatch(directive(getCSP(), "script-src"), /'unsafe-eval'/);
});

test("script-src에 'unsafe-inline' 포함 (인라인 스크립트/onclick 보존)", () => {
  assert.match(directive(getCSP(), "script-src"), /'unsafe-inline'/);
});

test("style-src 'unsafe-inline' (인라인 style 보존)", () => {
  assert.match(directive(getCSP(), "style-src"), /'unsafe-inline'/);
});

test("connect/img/media가 https/data 허용 (Drive/GitHub/업로드 보존)", () => {
  const csp = getCSP();
  assert.match(directive(csp, "connect-src"), /https:/);
  assert.match(directive(csp, "img-src"), /https:|data:/);
  assert.match(directive(csp, "img-src"), /data:/);
});

test("server.mjs: 깔끔한 URL rewrites 보존(≥15개, /hub 포함)", () => {
  const rw = getRewrites();
  const keys = Object.keys(rw);
  assert.ok(keys.length >= 15, `rewrites ${keys.length}개(≥15)`);
  assert.equal(rw["/hub"], "hub.html", "/hub → hub.html 유지");
  assert.equal(rw["/talk"], "talk.html", "/talk → talk.html 유지");
});

test("Vercel 산출물이 저장소에 남아있지 않음", () => {
  const url = (p) => fileURLToPath(new URL(p, import.meta.url));
  for (const f of ["../vercel.json", "../.vercelignore"]) {
    assert.throws(() => readFileSync(url(f)), /ENOENT/, `${f} 는 삭제되어야 함`);
  }
});
