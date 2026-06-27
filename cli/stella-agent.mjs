#!/usr/bin/env node
// cli/stella-agent.mjs — Stella Agent Code CLI (PC 터미널용)
// 배포된 프록시(/api/cc/*)를 호출 → PC에 ANTHROPIC_API_KEY 불필요(키는 서버에만).
// agentcore 로직 재사용. (백엔드는 OCI 우분투 서버 — 배포 보호 미사용.)
//
// 사용:
//   export CC_BASE_URL=https://<OCI-서버-도메인>
//   # (레거시) 배포 보호가 걸린 백엔드를 호출할 때만: --bypass <토큰>
//   node cli/stella-agent.mjs "write fibonacci.py with first 20 numbers and run it" --omc
//   node cli/stella-agent.mjs --list
//   node cli/stella-agent.mjs --resume <sessionId> "이어서 테스트도 추가해줘"
//   node cli/stella-agent.mjs --cancel <sessionId>
import { AgentRun, nextDelayMs, buildTranscript, CLAUDE_MODELS, DEFAULT_MODEL, resolveModel } from "../lib/agentcore.mjs";
import fs from "node:fs";

// ── 순수 인자 파서 (테스트 대상) ──
export function parseArgs(argv) {
  const a = { cmd: "run", prompt: "", model: null, budget: null, omc: false, base: null, bypass: null, session: null, save: null, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--list" || t === "list") a.cmd = "list";
    else if (t === "--cancel") { a.cmd = "cancel"; a.session = argv[++i]; }
    else if (t === "--resume") { a.cmd = "resume"; a.session = argv[++i]; }
    else if (t === "--model" || t === "-m") a.model = argv[++i];
    else if (t === "--budget" || t === "-b") a.budget = parseFloat(argv[++i]);
    else if (t === "--omc") a.omc = true;
    else if (t === "--base") a.base = argv[++i];
    else if (t === "--bypass") a.bypass = argv[++i];
    else if (t === "--save") a.save = argv[++i];
    else if (t === "--json") a.json = true;
    else if (t === "--help" || t === "-h") a.cmd = "help";
    else rest.push(t);
  }
  if (a.cmd === "run" || a.cmd === "resume") a.prompt = rest.join(" ").trim();
  return a;
}

const HELP = `Stella Agent Code CLI
  node cli/stella-agent.mjs "<프롬프트>" [옵션]      새 세션 시작 + 실시간 진행
  node cli/stella-agent.mjs --list                  세션 목록
  node cli/stella-agent.mjs --resume <id> ["턴"]    세션 재개(+선택 후속 프롬프트)
  node cli/stella-agent.mjs --cancel <id>           세션 중단
옵션:
  -m, --model <id>   ${CLAUDE_MODELS.map(m => m.id).join(" | ")}  (기본 ${DEFAULT_MODEL})
  -b, --budget <usd> 예산 상한 (기본 0.50)
  --omc              OMC(oh-my-claudecode) 멀티에이전트 모드
  --base <url>       프록시 베이스 (또는 env CC_BASE_URL)
  --bypass <token>   (레거시) 배포보호 바이패스 토큰 — OCI 서버는 불필요
  --save <file>      완료 후 트랜스크립트(.md) 저장
  --json             원시 JSON 출력`;

// ── 이 파일을 직접 실행할 때만 main 동작 (import 시엔 parseArgs만) ──
const isMain = (() => { try { return process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href; } catch { return false; } })();

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "help") { console.log(HELP); process.exit(0); }
  const base = (args.base || process.env.CC_BASE_URL || "").replace(/\/$/, "");
  // (레거시) 배포 보호 바이패스 토큰 — OCI 서버는 미사용. --bypass 로만 명시 주입.
  const bypass = args.bypass || process.env.DEPLOY_BYPASS_SECRET || "";
  if (!base) { console.error("오류: CC_BASE_URL(또는 --base)가 필요합니다.\n\n" + HELP); process.exit(2); }

  // 바이패스 토큰이 주어지면 일반 Authorization 헤더로 전달(특정 PaaS 종속 헤더 제거).
  const headers = (extra) => Object.assign({ "Content-Type": "application/json" }, bypass ? { Authorization: "Bearer " + bypass } : {}, extra || {});
  async function api(path, opts = {}) {
    const url = base + path;
    const r = await fetch(url, { method: opts.method || "GET", headers: headers(), body: opts.body ? JSON.stringify(opts.body) : undefined });
    const text = await r.text();
    let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
    if (!r.ok) { const e = new Error((j && (j.message || j.error)) || ("HTTP " + r.status)); e.status = r.status; throw e; }
    return j;
  }

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const ICON = (n) => n === "bash" ? "🔧" : (/write|create|str_replace|edit/.test(n) ? "✏️" : (/read|view/.test(n) ? "📄" : "🛠️"));

  async function pollLoop(sessionId, model, title, prompt) {
    const run = new AgentRun();
    const st = { textLen: 0, toolsPrinted: 0, resultSeqs: new Set() };
    let attempt = 0;
    process.stdout.write(`\n· 세션 ${sessionId}\n`);
    while (!run.done && attempt < 240) {
      let d;
      try { d = await api("/api/cc/events?session=" + encodeURIComponent(sessionId) + "&after=" + run.cursor); }
      catch (e) { attempt++; if (attempt > 8) { console.error("\n폴링 실패: " + e.message); break; } await sleep(nextDelayMs(attempt)); continue; }
      if (d.events && d.events.length) run.ingest(d.events);
      // 새 툴 출력
      for (let i = st.toolsPrinted; i < run.tools.length; i++) {
        const t = run.tools[i];
        process.stdout.write(`\n${ICON(t.name)} ${t.name}${t.input ? " " + JSON.stringify(t.input).slice(0, 160) : ""}\n`);
      }
      st.toolsPrinted = run.tools.length;
      for (const t of run.tools) {
        if (t.result != null && !st.resultSeqs.has(t.seq)) {
          st.resultSeqs.add(t.seq);
          const rs = (typeof t.result === "string" ? t.result : JSON.stringify(t.result)).slice(0, 600);
          process.stdout.write(`   ↳ ${rs.replace(/\n/g, "\n     ")}\n`);
        }
      }
      // 새 텍스트 delta
      if (run.text.length > st.textLen) { process.stdout.write(run.text.slice(st.textLen)); st.textLen = run.text.length; }
      if (run.done) break;
      attempt++;
      await sleep(nextDelayMs(attempt));
    }
    process.stdout.write(`\n\n${run.status === "error" ? "✗ 종료: " + (run.error || "error") : "✓ 완료"}\n`);
    if (args.save) {
      try { fs.writeFileSync(args.save, buildTranscript({ title, model, prompt, run })); console.log("저장: " + args.save); } catch (e) { console.error("저장 실패: " + e.message); }
    }
    return run;
  }

  (async () => {
    try {
      if (args.cmd === "list") {
        const d = await api("/api/cc/sessions");
        if (args.json) { console.log(JSON.stringify(d, null, 2)); return; }
        const items = d.items || [];
        if (!items.length) { console.log("세션 없음"); return; }
        for (const x of items) console.log(`${x.id}\t${x.status || ""}\t${x.model || ""}\t$${Number(x.cost_usd || 0).toFixed(3)}\t${x.title || ""}`);
        return;
      }
      if (args.cmd === "cancel") {
        if (!args.session) { console.error("--cancel <sessionId> 필요"); process.exit(2); }
        await api("/api/cc/cancel", { method: "POST", body: { session: args.session } });
        console.log("중단 요청 전송: " + args.session);
        return;
      }
      if (args.cmd === "resume") {
        if (!args.session) { console.error("--resume <sessionId> 필요"); process.exit(2); }
        if (args.prompt) await api("/api/cc/turn", { method: "POST", body: { session: args.session, prompt: args.prompt } });
        await pollLoop(args.session, args.model || DEFAULT_MODEL, "(재개)", args.prompt || "(재개)");
        return;
      }
      // run
      if (!args.prompt) { console.error("프롬프트가 필요합니다.\n\n" + HELP); process.exit(2); }
      const model = resolveModel(args.model || DEFAULT_MODEL);
      const budgetUsd = args.budget != null && !Number.isNaN(args.budget) ? args.budget : 0.5;
      console.log(`▶ 모델 ${model}${args.omc ? " +OMC" : ""} · 예산 $${budgetUsd}`);
      const start = await api("/api/cc/start", { method: "POST", body: { model, prompt: args.prompt, budgetUsd, omc: args.omc, title: args.prompt.slice(0, 60) } });
      if (!start.sessionId) throw new Error("start 실패: " + JSON.stringify(start));
      await pollLoop(start.sessionId, model, args.prompt.slice(0, 60), args.prompt);
    } catch (e) {
      console.error("\n오류: " + (e.message || e) + (e.status ? " (HTTP " + e.status + ")" : ""));
      if (e.status === 401 || e.status === 403) console.error("→ 인증 실패일 수 있습니다. 로그인/세션 또는 --bypass 토큰을 확인하세요.");
      process.exit(1);
    }
  })();
}

export default { parseArgs };
