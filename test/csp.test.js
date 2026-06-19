// CSP 헤더 테스트 (작업: unsafe-eval 허용). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const vercel = JSON.parse(readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"));

function getCSP() {
  const h = (vercel.headers || []).find(x => x.source === "/(.*)");
  const csp = h && (h.headers || []).find(x => x.key.toLowerCase() === "content-security-policy");
  return csp ? csp.value : "";
}
function directive(csp, name) {
  const m = csp.split(";").map(s => s.trim()).find(s => s.startsWith(name + " ") || s === name);
  return m || "";
}

test("CSP 헤더가 /(.*) 에 존재", () => {
  assert.ok(getCSP().length > 0, "CSP 헤더 정의됨");
});

test("script-src에 'unsafe-eval' 포함 (작업 목표)", () => {
  assert.match(directive(getCSP(), "script-src"), /'unsafe-eval'/);
});

test("script-src에 'unsafe-inline' 포함 (인라인 스크립트/onclick 보존 — 사이트 안 깨짐)", () => {
  assert.match(directive(getCSP(), "script-src"), /'unsafe-inline'/);
});

test("style-src 'unsafe-inline' (인라인 style 보존)", () => {
  assert.match(directive(getCSP(), "style-src"), /'unsafe-inline'/);
});

test("connect/img/media가 https 허용 (Drive/GitHub/업로드 보존)", () => {
  const csp = getCSP();
  assert.match(directive(csp, "connect-src"), /https:/);
  assert.match(directive(csp, "img-src"), /https:|data:/);
  assert.match(directive(csp, "img-src"), /data:/);
});

test("vercel.json: 기존 rewrites/functions 보존", () => {
  assert.ok(Array.isArray(vercel.rewrites) && vercel.rewrites.length >= 15, "rewrites 유지");
  assert.ok(vercel.functions, "functions 유지");
  assert.ok(vercel.rewrites.some(r => r.destination === "/hub.html"), "/hub rewrite 유지");
});
