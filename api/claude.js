/**
 * Claude API Route
 * 파일명: api/claude.js
 *
 * 역할:
 * - Stella Workspace에서 Claude 모델 호출
 * - API Key는 GitHub 소스에 넣지 않음
 * - Vercel 환경변수 ANTHROPIC_API_KEY 사용
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function normalizeClaudeModel(model) {
  const value = String(model || "").toLowerCase();

  if (value.includes("sonnet-4.6")) {
    return "claude-3-5-sonnet-latest";
  }

  if (value.includes("claude-3-5-sonnet")) {
    return "claude-3-5-sonnet-latest";
  }

  return "claude-3-5-sonnet-latest";
}

function normalizeMessages(messages = []) {
  return messages
    .filter(message => message && message.content)
    .map(message => ({
      role:
        message.role === "assistant" || message.role === "ai"
          ? "assistant"
          : "user",
      content: String(message.content)
    }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "ANTHROPIC_API_KEY is not configured"
      });
    }

    const {
      model,
      messages,
      systemPrompt,
      temperature = 0.3,
      maxTokens = 4096
    } = req.body || {};

    const normalizedMessages = normalizeMessages(messages);

    if (!normalizedMessages.length) {
      return res.status(400).json({
        error: "messages is required"
      });
    }

    const payload = {
      model: normalizeClaudeModel(model),
      max_tokens: maxTokens,
      temperature,
      messages: normalizedMessages
    };

    if (systemPrompt) {
      payload.system = String(systemPrompt);
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error || data
      });
    }

    const text =
      Array.isArray(data.content)
        ? data.content
            .filter(item => item.type === "text")
            .map(item => item.text)
            .join("\n")
        : "";

    return res.status(200).json({
      text,
      model: data.model,
      usage: data.usage,
      raw: data
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Claude request failed"
    });
  }
}
