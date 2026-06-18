// tests/test_agentcore.mjs — Stella Agent Code 핵심 로직 단위 테스트 (의존성 0)
import { CLAUDE_MODELS, DEFAULT_MODEL, isValidModel, resolveModel, AgentRun, nextDelayMs, buildTranscript, buildAgentSystem, OMC_REPO } from "../lib/agentcore.mjs";

let pass = 0, fail = 0;
function A(name, ok, extra) { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (ok || !extra ? "" : `  (${extra})`)); }

// ── 모델 검증/폴백 (1~4) ──
A("1 isValidModel opus", isValidModel("claude-opus-4-8") === true);
A("2 isValidModel 무효", isValidModel("gpt-4o") === false);
A("3 resolveModel 없는모델 → DEFAULT", resolveModel("없는모델") === DEFAULT_MODEL);
A("4 resolveModel 유효 → 그대로", resolveModel("claude-haiku-4-5-20251001") === "claude-haiku-4-5-20251001");

// ── AgentRun 누적/정렬/중복 (5~9) ──
{
  const r = new AgentRun();
  // 역순 입력 → seq 정렬 누적
  r.ingest([{ seq: 2, kind: "text", text: "world" }, { seq: 1, kind: "text", text: "hello " }]);
  A("5 역순 이벤트 seq 정렬 누적", r.text === "hello world", JSON.stringify(r.text));
  A("6 cursor = 최대 seq", r.cursor === 2, "cursor=" + r.cursor);
  // 이미 본 seq 재무시
  const n = r.ingest([{ seq: 1, kind: "text", text: "DUP" }, { seq: 2, kind: "text", text: "DUP" }]);
  A("7 이미 본 seq 재무시(fresh=0)", n === 0 && r.text === "hello world");
  // 새 seq만 반영
  const n2 = r.ingest([{ seq: 3, kind: "text", text: "!" }]);
  A("8 새 seq만 반영", n2 === 1 && r.text === "hello world!");
  A("9 초기 상태 running, done=false", new AgentRun().status === "running" && new AgentRun().done === false);
}

// ── tool_use / tool_result 매칭 (10~12) ──
{
  const r = new AgentRun();
  r.ingest([{ seq: 1, kind: "tool_use", name: "bash", input: { cmd: "ls" } }]);
  A("10 tool_use 누적 + result null", r.tools.length === 1 && r.tools[0].name === "bash" && r.tools[0].result === null);
  r.ingest([{ seq: 2, kind: "tool_result", name: "bash", result: "file.txt" }]);
  A("11 tool_result가 같은 이름 미완 tool_use에 매칭", r.tools.length === 1 && r.tools[0].result === "file.txt");
  // 짝 없는 tool_result → 새 항목으로
  r.ingest([{ seq: 3, kind: "tool_result", name: "write", result: "ok" }]);
  A("12 짝 없는 tool_result는 새 항목", r.tools.length === 2 && r.tools[1].name === "write" && r.tools[1].input === null);
}

// ── 종료 감지 (13~15) ──
{
  const r1 = new AgentRun();
  r1.ingest([{ seq: 1, kind: "status", status: "status_idle" }]);
  A("13 status_idle → done", r1.status === "idle" && r1.done === true);

  const r2 = new AgentRun();
  r2.ingest([{ seq: 1, kind: "status", status: "error", error: "budget exceeded" }]);
  A("14 status error → done + 에러 메시지 보존", r2.status === "error" && r2.done === true && r2.error === "budget exceeded");

  const r3 = new AgentRun();
  r3.ingest([{ seq: 1, kind: "status", status: "running" }]);
  A("15 running 상태는 done=false", r3.status === "running" && r3.done === false);
}

// ── 백오프 (16) ──
A("16 nextDelayMs 증가+상한 4000", nextDelayMs(0) === 800 && nextDelayMs(3) === 2000 && nextDelayMs(100) === 4000);

// ── 트랜스크립트 (17) ──
{
  const r = new AgentRun();
  r.ingest([
    { seq: 1, kind: "tool_use", name: "write", input: { path: "fib.py" } },
    { seq: 2, kind: "text", text: "완료했습니다." },
    { seq: 3, kind: "status", status: "status_idle" },
  ]);
  const t = buildTranscript({ title: "테스트", model: "claude-haiku-4-5-20251001", prompt: "fib 작성", run: r });
  A("17 트랜스크립트: 모델·요청·툴·응답 포함",
    t.includes("# 테스트") && t.includes("claude-haiku-4-5-20251001") && t.includes("fib 작성") &&
    t.includes("🔧 **write**") && t.includes("완료했습니다."),
    JSON.stringify(t.slice(0, 60)));
}

// ── OMC 부트스트랩 시스템 프롬프트 (18~19) ──
{
  const base = buildAgentSystem(false);
  const omc = buildAgentSystem(true);
  A("18 OMC off: 기본 프롬프트(OMC 미포함)", base.indexOf("Stella Agent Code") >= 0 && base.indexOf("OMC") < 0 && base.indexOf(OMC_REPO) < 0);
  A("19 OMC on: 부트스트랩 지시 + repo 포함", omc.indexOf("OMC") >= 0 && omc.indexOf(OMC_REPO) >= 0 && omc.indexOf("npm install") >= 0);
}

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
