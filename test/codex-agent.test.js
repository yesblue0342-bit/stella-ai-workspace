// lib/codex-agent.mjs runCodexAgentLoop 단위 테스트 — Stella Codex 무인 자동화 루프 (실행: npm test)
// 실제 OpenAI/파일시스템 없이 callOpenAI/runTool을 페이크로 주입해 루프 제어 흐름만 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCodexAgentLoop, CODEX_TOOLS } from "../lib/codex-agent.mjs";

const U = (p, c) => ({ prompt_tokens: p, completion_tokens: c, total_tokens: p + c });

test("CODEX_TOOLS: 필수 5개 도구 정의(bash 없음)", () => {
  const names = CODEX_TOOLS.map((t) => t.function.name);
  assert.deepEqual(names.sort(), ["delete_file", "git_commit_and_push", "list_dir", "read_file", "write_file"].sort());
  assert.ok(!names.includes("bash"), "임의 bash 도구는 제공하지 않는다(프로덕션 호스트 보호)");
});

test("tool_calls 없이 즉시 텍스트 응답 → 1회 호출로 종료, usage 반영", async () => {
  let calls = 0;
  const out = await runCodexAgentLoop({
    system: "sys", prompt: "hi",
    callOpenAI: async () => { calls++; return { message: { content: "done", tool_calls: [] }, usage: U(10, 5) }; },
    runTool: async () => { throw new Error("should not be called"); },
  });
  assert.equal(calls, 1);
  assert.equal(out.text, "done");
  assert.equal(out.done, true);
  assert.deepEqual(out.steps, []);
  assert.deepEqual(out.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
});

test("도구 호출 1회 후 완료 → steps에 기록되고 결과가 메시지로 피드백된다 + usage 누적", async () => {
  let seenToolMessage = null;
  const out = await runCodexAgentLoop({
    system: "sys", prompt: "edit readme",
    callOpenAI: async (messages) => {
      const last = messages[messages.length - 1];
      if (last.role === "tool") { seenToolMessage = last; return { message: { content: "커밋 완료", tool_calls: [] }, usage: U(20, 10) }; }
      return { message: { content: null, tool_calls: [{ id: "c1", function: { name: "write_file", arguments: JSON.stringify({ path: "a.txt", content: "x" }) } }] }, usage: U(5, 2) };
    },
    runTool: async (name, args) => {
      assert.equal(name, "write_file");
      assert.equal(args.path, "a.txt");
      return "저장됨: a.txt";
    },
  });
  assert.equal(out.text, "커밋 완료");
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].name, "write_file");
  assert.equal(out.steps[0].result, "저장됨: a.txt");
  assert.equal(seenToolMessage.content, "저장됨: a.txt");
  assert.deepEqual(out.usage, { prompt_tokens: 25, completion_tokens: 12, total_tokens: 37 });
});

test("여러 도구 호출이 한 턴에 와도 순서대로 모두 실행된다", async () => {
  let turn = 0;
  const executed = [];
  const out = await runCodexAgentLoop({
    system: "sys", prompt: "p",
    callOpenAI: async () => {
      turn++;
      if (turn === 1) {
        return { message: { content: null, tool_calls: [
          { id: "1", function: { name: "read_file", arguments: '{"path":"a"}' } },
          { id: "2", function: { name: "read_file", arguments: '{"path":"b"}' } },
        ] }, usage: U(1, 1) };
      }
      return { message: { content: "ok", tool_calls: [] }, usage: U(1, 1) };
    },
    runTool: async (name, args) => { executed.push(args.path); return "content of " + args.path; },
  });
  assert.deepEqual(executed, ["a", "b"]);
  assert.equal(out.steps.length, 2);
  assert.equal(out.text, "ok");
});

test("runTool이 던지면 에러 문자열이 결과로 기록되고 루프가 계속된다(중단하지 않음)", async () => {
  let turn = 0;
  const out = await runCodexAgentLoop({
    system: "sys", prompt: "p",
    callOpenAI: async () => {
      turn++;
      if (turn === 1) return { message: { content: null, tool_calls: [{ id: "1", function: { name: "read_file", arguments: '{"path":"missing"}' } }] }, usage: null };
      return { message: { content: "복구함", tool_calls: [] }, usage: null };
    },
    runTool: async () => { throw new Error("파일 없음"); },
  });
  assert.match(out.steps[0].result, /오류: 파일 없음/);
  assert.equal(out.text, "복구함");
});

test("최대 반복 횟수 도달 시 경고 텍스트와 함께 종료(무한루프 방지)", async () => {
  let calls = 0;
  const out = await runCodexAgentLoop({
    system: "sys", prompt: "p", maxIterations: 3,
    callOpenAI: async () => { calls++; return { message: { content: null, tool_calls: [{ id: String(calls), function: { name: "list_dir", arguments: "{}" } }] }, usage: U(1, 1) }; },
    runTool: async () => "ok",
  });
  assert.equal(calls, 3);
  assert.equal(out.done, false);
  assert.match(out.text, /최대 반복 횟수/);
  assert.deepEqual(out.usage, { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 });
});

test("잘못된 JSON arguments는 빈 객체로 폴백(크래시하지 않음)", async () => {
  let receivedArgs = "unset";
  await runCodexAgentLoop({
    system: "sys", prompt: "p",
    callOpenAI: async (messages) => {
      if (messages.some((m) => m.role === "tool")) return { message: { content: "done", tool_calls: [] }, usage: null };
      return { message: { content: null, tool_calls: [{ id: "1", function: { name: "list_dir", arguments: "not json{{" } }] }, usage: null };
    },
    runTool: async (name, args) => { receivedArgs = args; return "ok"; },
  });
  assert.deepEqual(receivedArgs, {});
});

test("usage가 null/undefined로 와도 누적이 깨지지 않는다(0 유지)", async () => {
  const out = await runCodexAgentLoop({
    system: "sys", prompt: "p",
    callOpenAI: async () => ({ message: { content: "done", tool_calls: [] }, usage: undefined }),
    runTool: async () => "ok",
  });
  assert.deepEqual(out.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
});
