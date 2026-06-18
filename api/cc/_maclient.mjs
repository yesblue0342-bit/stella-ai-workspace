// api/cc/_maclient.mjs — Anthropic Managed Agents REST 클라이언트 + 이벤트 정규화 + 재사용 캐시
// (_ 프리픽스 → Vercel 라우트 아님. 프록시 함수들이 import해서 사용)
// 베타 헤더: managed-agents-2026-04-01

const BASE = "https://api.anthropic.com";
const BETA = "managed-agents-2026-04-01";

function apiKey() {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error("ANTHROPIC_API_KEY not configured");
  return k;
}
function headers() {
  return {
    "x-api-key": apiKey(),
    "anthropic-version": "2023-06-01",
    "anthropic-beta": BETA,
    "content-type": "application/json",
  };
}
export async function maFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json && json.error && (json.error.message || json.error.type)) || res.status;
    const e = new Error("Managed Agents API " + res.status + ": " + msg);
    e.status = res.status; e.body = json;
    throw e;
  }
  return json;
}

// ── 에이전트/환경 재사용 (warm 인스턴스 메모리 + Azure 영속) ──
const _agentCache = new Map(); // model -> agentId
let _envId = null;

export async function getOrCreateEnvironment(getMeta, setMeta) {
  if (_envId) return _envId;
  try { const m = getMeta && (await getMeta("cc_env_id")); if (m) { _envId = m; return _envId; } } catch {}
  const env = await maFetch("/v1/environments", {
    method: "POST",
    body: { name: "stella-cc-env", config: { type: "cloud", networking: { type: "unrestricted" } } },
  });
  _envId = env.id;
  try { setMeta && (await setMeta("cc_env_id", _envId)); } catch {}
  return _envId;
}
export async function getOrCreateAgent(model, getMeta, setMeta) {
  if (_agentCache.has(model)) return _agentCache.get(model);
  const metaKey = "cc_agent_" + model;
  try { const m = getMeta && (await getMeta(metaKey)); if (m) { _agentCache.set(model, m); return m; } } catch {}
  const agent = await maFetch("/v1/agents", {
    method: "POST",
    body: {
      name: "Stella Claude Code (" + model + ")",
      model,
      system: "You are Stella Claude Code, an autonomous coding agent running in a sandbox. Write clean, well-documented code, run and verify it, and explain results concisely. Reply in Korean when the user writes Korean.",
      tools: [{ type: "agent_toolset_20260401" }],
    },
  });
  _agentCache.set(model, agent.id);
  try { setMeta && (await setMeta(metaKey, agent.id)); } catch {}
  return agent.id;
}

export async function createSession(agentId, environmentId, title) {
  const s = await maFetch("/v1/sessions", {
    method: "POST",
    body: { agent: agentId, environment_id: environmentId, title: title || "Stella Claude Code 세션" },
  });
  return s.id;
}
const SP = (id) => "/v1/sessions/" + encodeURIComponent(id);
export async function sendUserMessage(sessionId, text) {
  return maFetch(SP(sessionId) + "/events?beta=true", {
    method: "POST",
    body: { events: [{ type: "user.message", content: [{ type: "text", text: String(text || "") }] }] },
  });
}
export async function interruptSession(sessionId) {
  return maFetch(SP(sessionId) + "/events?beta=true", {
    method: "POST",
    body: { events: [{ type: "user.interrupt" }] },
  });
}
export async function listEvents(sessionId) {
  const r = await maFetch(SP(sessionId) + "/events?beta=true", { method: "GET" });
  return Array.isArray(r.data) ? r.data : (Array.isArray(r) ? r : []);
}
export async function getSession(sessionId) {
  return maFetch(SP(sessionId) + "?beta=true", { method: "GET" });
}

// ── raw 이벤트 → 정규화 ({seq,kind,...}). seq = 시간순 인덱스(1-based, append-only라 안정적) ──
const TERMINAL = {
  "session.status_idle": "idle",
  "session.status_terminated": "error",
  "session.error": "error",
  "session.deleted": "error",
};
export function normalizeEvents(rawList) {
  const out = [];
  const idToName = {};
  let seq = 0;
  for (const ev of (rawList || [])) {
    seq++;
    const type = (ev && ev.type) || "";
    if (type === "agent.message") {
      const txt = (ev.content || []).filter(b => b && b.type === "text").map(b => b.text || "").join("");
      if (txt) out.push({ seq, kind: "text", text: txt });
    } else if (type === "agent.tool_use" || type === "agent.mcp_tool_use" || type === "agent.custom_tool_use") {
      const name = ev.name || "tool";
      if (ev.id) idToName[ev.id] = name;
      out.push({ seq, kind: "tool_use", name, input: ev.input ?? null });
    } else if (type === "agent.tool_result" || type === "agent.mcp_tool_result") {
      const name = ev.name || idToName[ev.tool_use_id] || "tool";
      const result = ev.content != null ? ev.content : (ev.result != null ? ev.result : null);
      out.push({ seq, kind: "tool_result", name, result });
    } else if (TERMINAL[type] !== undefined) {
      out.push({ seq, kind: "status", status: TERMINAL[type], error: (ev.error && ev.error.message) || ev.stop_reason || null });
    } else if (type === "session.status_running") {
      out.push({ seq, kind: "status", status: "running" });
    }
    // 그 외(span.*, user.*, system.*, agent.thinking)는 무시
  }
  return out;
}

// ── 비용 추정(예산 가드레일용, 대략 단가 USD/1M tokens) ──
const PRICE = {
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
export function estimateCostUsd(model, usage) {
  const p = PRICE[model] || PRICE["claude-sonnet-4-6"];
  const u = usage || {};
  const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const outTok = u.output_tokens || 0;
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

export default {
  maFetch, getOrCreateEnvironment, getOrCreateAgent, createSession,
  sendUserMessage, interruptSession, listEvents, getSession, normalizeEvents, estimateCostUsd,
};
