// lib/codex-agent.mjs — OpenAI Chat Completions 함수호출 기반 코딩 에이전트 루프 (Stella Codex 무인 자동화)
// Anthropic Managed Agents(cc 전용)가 제공하는 호스팅 샌드박스가 OpenAI 쪽엔 없어, 실제 파일/git 조작은
// 서버(OCI)가 구조화된 도구(list_dir/read_file/write_file/delete_file/git_commit_and_push)로만 수행한다.
// 임의 bash 실행은 프로덕션 호스트(다른 Stella 앱과 같은 컨테이너) 보호를 위해 의도적으로 제공하지 않는다.

export const CODEX_TOOLS = [
  { type: "function", function: {
    name: "list_dir",
    description: "레포 워크스페이스 내 디렉터리 목록 조회(상대경로, 생략 시 루트).",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: [] },
  } },
  { type: "function", function: {
    name: "read_file",
    description: "레포 워크스페이스 내 파일 내용 읽기(상대경로).",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  } },
  { type: "function", function: {
    name: "write_file",
    description: "레포 워크스페이스 내 파일 생성/덮어쓰기(상대경로, 상위 디렉터리 자동 생성).",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  } },
  { type: "function", function: {
    name: "delete_file",
    description: "레포 워크스페이스 내 파일 삭제(상대경로).",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  } },
  { type: "function", function: {
    name: "git_commit_and_push",
    description: "모든 변경사항을 커밋하고 원격 브랜치로 push한다. 작업을 완료로 간주하기 전 반드시 호출해야 한다.",
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  } },
];

const MAX_ITERATIONS = 15;
const MAX_TOOL_RESULT_CHARS = 20000;

function truncate(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + `\n…(${s.length - n}자 생략)` : s;
}

// callOpenAI(messages) => Promise<{ message:{content,tool_calls}, usage }> — 실제 fetch는 호출부(api/codex/agent.js) 주입.
// runTool(name, args)   => Promise<string>                                — 실제 파일/git I/O는 호출부 주입.
// 반환: { text, steps:[{name,input,result}], done, usage:{prompt_tokens,completion_tokens,total_tokens} }
export async function runCodexAgentLoop({ system, prompt, callOpenAI, runTool, maxIterations = MAX_ITERATIONS }) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: String(prompt || "") },
  ];
  const steps = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const addUsage = (u) => {
    if (!u) return;
    usage.prompt_tokens += u.prompt_tokens || 0;
    usage.completion_tokens += u.completion_tokens || 0;
    usage.total_tokens += u.total_tokens || 0;
  };
  for (let i = 0; i < maxIterations; i++) {
    const { message: msg, usage: u } = await callOpenAI(messages);
    addUsage(u);
    if (!msg) throw new Error("OpenAI 응답 없음");
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (!calls.length) {
      return { text: msg.content || "", steps, done: true, usage };
    }
    messages.push({ role: "assistant", content: msg.content || null, tool_calls: calls });
    for (const c of calls) {
      const name = c.function && c.function.name;
      let args = {};
      try { args = JSON.parse((c.function && c.function.arguments) || "{}"); } catch { args = {}; }
      let result;
      try { result = await runTool(name, args); }
      catch (e) { result = "오류: " + (e && e.message ? e.message : String(e)); }
      const resultStr = truncate(typeof result === "string" ? result : JSON.stringify(result), MAX_TOOL_RESULT_CHARS);
      steps.push({ name, input: args, result: resultStr });
      messages.push({ role: "tool", tool_call_id: c.id, content: resultStr });
    }
  }
  return {
    text: "⚠️ 최대 반복 횟수(" + maxIterations + ")에 도달해 중단했습니다. 더 작은 단위로 나눠 다시 요청하세요.",
    steps, done: false, usage,
  };
}

export default { CODEX_TOOLS, runCodexAgentLoop };
