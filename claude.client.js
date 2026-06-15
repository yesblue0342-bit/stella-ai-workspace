/**
 * Claude Client
 * 파일명: claude.client.js
 *
 * 역할:
 * - Claude 모델 호출용 클라이언트
 * - API Key는 절대 이 파일에 넣지 않습니다.
 * - 실제 API Key는 Vercel/Worker 환경변수 ANTHROPIC_API_KEY에 저장합니다.
 *
 * 사용 흐름:
 * Stella UI
 * → /api/claude
 * → 서버/Worker
 * → Anthropic Claude API
 */

export const CLAUDE_MODELS = [
  {
    id: "claude_sonnet-4.6",
    label: "claude_sonnet-4.6",
    provider: "anthropic"
  },
  {
    id: "claude-3-5-sonnet-latest",
    label: "Claude 3.5 Sonnet",
    provider: "anthropic"
  }
];

export function isClaudeModel(modelId) {
  return String(modelId || "")
    .toLowerCase()
    .includes("claude");
}

export function normalizeClaudeModel(modelId) {
  const model = String(modelId || "").toLowerCase();

  if (model.includes("sonnet-4.6")) {
    return "claude_sonnet-4.6";
  }

  if (model.includes("claude-3-5-sonnet")) {
    return "claude-3-5-sonnet-latest";
  }

  return "claude-3-5-sonnet-latest";
}

export function buildClaudeMessages(messages = []) {
  return messages
    .filter(message => message && message.content)
    .map(message => {
      const role =
        message.role === "assistant" || message.role === "ai"
          ? "assistant"
          : "user";

      return {
        role,
        content: String(message.content)
      };
    });
}

export async function callClaude({
  model,
  messages,
  systemPrompt = "",
  temperature = 0.3,
  maxTokens = 4096
}) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: normalizeClaudeModel(model),
      messages: buildClaudeMessages(messages),
      systemPrompt,
      temperature,
      maxTokens
    })
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Claude API error: ${response.status} ${errorText}`
    );
  }

  const data = await response.json();

  return {
    text: data.text || "",
    raw: data
  };
}

export default {
  CLAUDE_MODELS,
  isClaudeModel,
  normalizeClaudeModel,
  buildClaudeMessages,
  callClaude
};
