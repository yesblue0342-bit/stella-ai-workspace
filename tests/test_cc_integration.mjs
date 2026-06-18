// tests/test_cc_integration.mjs — Stella Claude Code 통합 테스트 (실 1회, 저렴: Haiku + 소액 예산)
// 배포된 프록시를 대상으로 한다. 실행:
//   CC_BASE_URL=https://stella-ai-workspace.vercel.app node tests/test_cc_integration.mjs
// CC_BASE_URL 미설정 시 SKIP(과금/키 필요). ANTHROPIC_API_KEY는 서버(Vercel)에만 있으면 된다.
import { AgentRun, nextDelayMs } from "../lib/agentcore.mjs";

const BASE = process.env.CC_BASE_URL || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function A(name, ok, extra) { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (ok || !extra ? "" : `  (${extra})`)); }

if (!BASE) {
  console.log("SKIP: CC_BASE_URL 미설정 — 배포 환경에서 실행하세요.");
  console.log("예) CC_BASE_URL=https://stella-ai-workspace.vercel.app node tests/test_cc_integration.mjs");
  console.log("\n총 0건 (SKIPPED): 통합 테스트는 배포된 프록시 + 서버측 ANTHROPIC_API_KEY 필요.");
  process.exit(0);
}

try {
  const startRes = await fetch(BASE + "/api/cc/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", budgetUsd: 0.25, prompt: "write fibonacci.py with the first 20 numbers and run it" }),
  });
  const start = await startRes.json();
  A("start: sessionId 반환", !!(start && start.sessionId), JSON.stringify(start).slice(0, 120));

  const run = new AgentRun();
  let attempt = 0;
  while (!run.done && attempt < 120) {
    const r = await fetch(BASE + "/api/cc/events?session=" + encodeURIComponent(start.sessionId) + "&after=" + run.cursor);
    const d = await r.json();
    if (d.events && d.events.length) run.ingest(d.events);
    if (run.done) break;
    attempt++;
    await sleep(nextDelayMs(attempt));
  }

  const names = run.tools.map((t) => t.name);
  A("write 툴 발생", names.includes("write") || names.some((n) => /write|create|str_replace/.test(n)), names.join(","));
  A("bash 실행", names.includes("bash"), names.join(","));
  A("status idle 도달", run.status === "idle", "status=" + run.status + " err=" + (run.error || ""));
  const blob = run.text + " " + JSON.stringify(run.tools);
  A("결과에 피보나치 수열", /0[,\s]+1[,\s]+1[,\s]+2[,\s]+3[,\s]+5[,\s]+8[,\s]+13[,\s]+21/.test(blob) || /fibonacci/i.test(blob), blob.slice(0, 80));
} catch (e) {
  A("통합 실행 예외 없음", false, String(e.message || e));
}

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
