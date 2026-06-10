export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      message,
      messages = [],
      history = [],
      model,
      system,
      systemPrompt
    } = req.body || {};

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "ANTHROPIC_API_KEY is not configured"
      });
    }

    const claudeMessages = buildMessages({ message, messages, history });

    if (!claudeMessages.length) {
      return res.status(400).json({
        error: "message is required"
      });
    }

    const payload = {
      model: normalizeClaudeModel(model),
      max_tokens: 4096,
      temperature: 0.3,
      messages: claudeMessages
    };

    const finalSystem = systemPrompt || system;
    if (finalSystem) {
      payload.system = String(finalSystem);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    });

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || raw || "Claude API Error",
        detail: data
      });
    }

    const text = Array.isArray(data.content)
      ? data.content
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n")
      : "";

    return res.status(200).json({
      text: text || "응답 없음",
      model: data.model,
      usage: data.usage
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Claude Server Error"
    });
  }
}

function buildMessages({ message, messages, history }) {
  const source = [];

  if (Array.isArray(history)) source.push(...history);
  if (Array.isArray(messages)) source.push(...messages);

  if (message) {
    source.push({
      role: "user",
      content: String(message)
    });
  }

  const result = [];

  source.forEach(item => {
    if (!item) return;

    const content = String(item.content || item.text || "").trim();
    if (!content) return;

    const role = item.role === "assistant" || item.role === "ai"
      ? "assistant"
      : "user";

    const last = result[result.length - 1];

    if (last && last.role === role) {
      last.content += "\n\n" + content;
    } else {
      result.push({ role, content });
    }
  });

  if (result[0]?.role === "assistant") {
    result.shift();
  }

  return result;
}

function normalizeClaudeModel(model) {
  const value = String(model || "").toLowerCase();

  if (value.includes("opus")) {
    return "claude-3-opus-20240229";
  }

  return "claude-3-5-sonnet-20241022";
}
