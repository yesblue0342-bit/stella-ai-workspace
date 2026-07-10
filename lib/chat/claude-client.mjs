// lib/chat/claude-client.mjs — Anthropic Messages API 호출부. api/chat.js 분리의 일부.
// 모델 패밀리별 빌링 분리를 위해 OpenAI 경로와 완전히 분리되어 있다(Claude 선택 시 OpenAI 미호출).

import { visionImageBlock, ensureVisionModel, parseDataUrl } from "../vision-format.mjs";

const CLAUDE_MODELS = {
  "claude-fable-5": "claude-fable-5",
  "claude-opus-4-8": "claude-opus-4-8",
  "claude-opus-4-7": "claude-opus-4-7",
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
};

const CLAUDE_MAX_TOKENS = 4096;
const CLAUDE_TIMEOUT_MS = 55000; // 장기 요청을 우아하게 종료해 좀비 연결 방지

/** UI가 보내는 모델 별칭을 실제 Anthropic 모델 ID로 정규화. */
export function resolveClaudeModel(model) {
  const m = String(model || "").toLowerCase().trim();
  if (CLAUDE_MODELS[m]) return CLAUDE_MODELS[m];
  if (m.includes("fable")) return "claude-fable-5";
  if (m.includes("opus")) {
    if (m.includes("4.8") || m.includes("4-8")) return "claude-opus-4-8";
    if (m.includes("4.7") || m.includes("4-7")) return "claude-opus-4-7";
    if (m.includes("4.6") || m.includes("4-6")) return "claude-opus-4-6";
    return "claude-opus-4-8";
  }
  if (m.includes("haiku")) return "claude-haiku-4-5-20251001";
  if (m.includes("sonnet")) return "claude-sonnet-4-6";
  if (m.includes("claude")) return "claude-sonnet-4-6";
  return "claude-sonnet-4-6";
}

/** 모델 이름이 Claude 계열(빌링 분리 대상)인가. */
export function isClaudeModelName(model) {
  const m = String(model || "").toLowerCase();
  return m.includes("claude") || m.includes("fable");
}

/**
 * Anthropic Messages API 호출.
 * @returns {Promise<string>} 답변 텍스트 (max_tokens 절단 시 이어쓰기 안내 부착)
 */
export async function callClaude({ model, system, history, message, images = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const imgs = (Array.isArray(images) ? images : []).filter((u) => u && String(u).startsWith("data:"));
  const selectedModel = ensureVisionModel(resolveClaudeModel(model), imgs.length > 0, "claude");

  // Anthropic Messages API는 첫 메시지가 user여야 한다(assistant로 시작하면 400).
  // trimHistoryByChars/slice(-12)가 자른 히스토리는 assistant로 시작할 수 있으므로 선두 assistant 제거.
  const h = (Array.isArray(history) ? history : []).slice(-12);
  while (h.length && h[0] && h[0].role === "assistant") h.shift();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: CLAUDE_MAX_TOKENS,
        system,
        messages: [
          ...h.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
          { role: "user", content: imgs.length > 0
            ? [...imgs.map((u) => { const { base64, mediaType } = parseDataUrl(u); return visionImageBlock({ api: "claude", base64, mediaType }); }), { type: "text", text: String(message || "") }]
            : String(message || "") },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Claude API error");
    let text = data.content?.map((c) => c.text || "").join("\n") || "응답 없음";
    // max_tokens에서 잘린 답변을 완결된 것처럼 반환하지 않는다 — 사용자에게 이어쓰기 안내.
    if (data.stop_reason === "max_tokens") {
      text += "\n\n⚠️ 답변이 최대 길이 제한으로 잘렸습니다. \"이어서 계속\"이라고 입력하면 이어서 작성합니다.";
    }
    return text;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("응답 시간이 너무 깁니다. 질문을 더 짧게 해주세요.");
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 대화에서 기억할 정보를 추출할 때 쓰는 저가 모델(haiku) 호출. JSON 문자열을 반환한다.
 * @returns {Promise<string>}
 */
export async function callClaudeJson({ prompt, maxTokens = 512 }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: "JSON only.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "{}";
}
