// POST /api/codex/agent — Stella Codex(OpenAI 백엔드) 무인 자동화 엔드포인트.
// 레포를 clone하고, OpenAI 함수호출 루프(lib/codex-agent.mjs)로 파일을 읽고/쓰고, 완료 시 커밋+push한다.
// Anthropic Managed Agents(cc 전용)의 호스팅 샌드박스가 OpenAI 쪽엔 없어 이 서버 프로세스가 직접
// git/파일 조작을 수행한다 — 그래서 임의 bash 는 제공하지 않는다(다른 Stella 앱과 같은 프로덕션 컨테이너 보호).
import { CODEX_TOOLS, runCodexAgentLoop } from "../../lib/codex-agent.mjs";
import {
  createWorkspace, destroyWorkspace, listDir, readFileRel, writeFileRel, deleteFileRel, commitAndPush,
} from "../../lib/codex-workspace.mjs";

const CODEX_AGENT_SYSTEM =
  "You are Stella Codex, an autonomous coding agent (OpenAI-backed) working inside a cloned GitHub repository. " +
  "Use the provided tools (list_dir/read_file/write_file/delete_file/git_commit_and_push) to inspect and modify real files — " +
  "always read relevant files before editing; never invent file contents. " +
  "When the task is complete, call git_commit_and_push with a concise commit message — do not consider the task done until you have committed and pushed (skip only if there truly are no changes). " +
  "Reply in Korean when the user writes Korean. " +
  "You do NOT have a shell — you cannot run tests, install packages, or run build commands. Work by reading/writing files directly, and say so if the task requires running code.";

function ghToken() {
  return String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN || "").trim();
}

async function callOpenAIOnce(messages, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { const e = new Error("OPENAI_API_KEY not configured"); e.status = 500; throw e; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.1, messages, tools: CODEX_TOOLS, tool_choice: "auto" }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || ("OpenAI API error " + r.status));
    return data.choices?.[0]?.message;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("OpenAI 응답 시간 초과");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "POST only" });
  const { prompt, owner, repo, branch, model } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ ok: false, message: "prompt required" });
  if (!owner || !repo) return res.status(400).json({ ok: false, message: "owner, repo required" });

  const token = ghToken();
  const mdl = String(model || "gpt-4.1-mini");
  const br = String(branch || "main").trim() || "main";

  let ws = null;
  try {
    ws = await createWorkspace({ owner, repo, branch: br, token });
  } catch (e) {
    const raw = String((e && e.message) || e);
    const msg = !token
      ? "레포 clone 실패 — 서버 GITHUB_TOKEN 미설정(비공개 레포는 토큰 필요): " + raw.slice(0, 200)
      : "레포 clone 실패: " + raw.slice(0, 200);
    return res.status(502).json({ ok: false, message: msg });
  }

  let committed = false;
  const runTool = async (name, args) => {
    if (name === "list_dir") return listDir(ws, args.path);
    if (name === "read_file") return readFileRel(ws, args.path);
    if (name === "write_file") return writeFileRel(ws, args.path, args.content);
    if (name === "delete_file") return deleteFileRel(ws, args.path);
    if (name === "git_commit_and_push") {
      const out = await commitAndPush(ws, args.message, token);
      if (/커밋\+push 완료/.test(out)) committed = true;
      return out;
    }
    return "알 수 없는 도구: " + name;
  };

  try {
    const result = await runCodexAgentLoop({
      system: CODEX_AGENT_SYSTEM,
      prompt,
      callOpenAI: (messages) => callOpenAIOnce(messages, mdl),
      runTool,
    });
    return res.status(200).json({
      ok: true, text: result.text, steps: result.steps, committed,
      repo: owner + "/" + repo, branch: br,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, message: String((e && e.message) || e) });
  } finally {
    await destroyWorkspace(ws);
  }
}
