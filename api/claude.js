export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    const model =
      body.model ||
      "claude-sonnet-4-6";

    const system =
      body.system ||
      body.systemPrompt ||
      "";

    const history =
      Array.isArray(body.history)
        ? body.history
        : [];

    const incomingMessages =
      Array.isArray(body.messages)
        ? body.messages
        : [];

    const message =
      body.message ||
      body.prompt ||
      body.content ||
      body.input ||
      body.text ||
      getLastUserMessage(incomingMessages) ||
      "";

    if (!message) {
      return res.status(400).json({
        provider: "claude",
        error: "message is required",
        receivedKeys: Object.keys(body),
        bodyPreview: JSON.stringify(body).slice(0, 500)
      });
    }

    const apiKey =
      process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        provider: "claude",
        error: "ANTHROPIC_API_KEY not configured"
      });
    }

    const messages =
      buildClaudeMessages({
        history,
        incomingMessages,
        message
      });

    const payload = {
      model:
        normalizeClaudeModel(model),
      max_tokens:
        Number(body.maxTokens || body.max_tokens || 4096),
      temperature:
        Number(body.temperature ?? 0.3),
      messages
    };

    if (system) {
      payload.system = String(system);
    }

    const response =
      await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify(payload)
        }
      );

    const data =
      await safeJson(response);

    if (!response.ok) {
      return res.status(response.status).json({
        provider: "claude",
        error:
          data.error?.message ||
          data.raw ||
          "Claude API Error",
        requestedModel:
          payload.model,
        detail:
          data
      });
    }

    const text =
      Array.isArray(data.content)
        ? data.content
            .filter(item => item.type === "text")
            .map(item => item.text || "")
            .join("\n")
        : "";

    return res.status(200).json({
      provider: "claude",
      model: data.model,
      text: text || "응답 없음",
      usage: data.usage
    });

  } catch (error) {
    return res.status(500).json({
      provider: "claude",
      error:
        error.message ||
        "Server Error"
    });
  }
}

function getLastUserMessage(messages) {
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i];

    if (
      item &&
      item.role === "user" &&
      item.content
    ) {
      return String(item.content);
    }
  }

  return "";
}

function buildClaudeMessages({
  history,
  incomingMessages,
  message
}) {
  const source =
    incomingMessages.length
      ? incomingMessages
      : history;

  const messages = [];

  if (Array.isArray(source)) {
    source.forEach(item => {
      if (!item || !item.content) {
        return;
      }

      const role =
        item.role === "assistant"
          ? "assistant"
          : "user";

      const content =
        String(item.content || "").trim();

      if (!content) {
        return;
      }

      const last =
        messages[messages.length - 1];

      if (last && last.role === role) {
        last.content += "\n\n" + content;
      } else {
        messages.push({
          role,
          content
        });
      }
    });
  }

  while (
    messages.length > 0 &&
    messages[0].role === "assistant"
  ) {
    messages.shift();
  }

  const last =
    messages[messages.length - 1];

  if (
    !last ||
    last.role !== "user" ||
    last.content !== String(message)
  ) {
    messages.push({
      role: "user",
      content: String(message)
    });
  }

  return messages;
}

function normalizeClaudeModel(model) {
  const value =
    String(model || "")
      .toLowerCase();

  if (value.includes("opus")) {
    return "claude-opus-4-8";
  }

  if (value.includes("haiku")) {
    return "claude-haiku-4-5-20251001";
  }

  if (value.includes("4.6")) {
    return "claude-sonnet-4-6";
  }

  if (value.includes("4-6")) {
    return "claude-sonnet-4-6";
  }

  if (value.includes("sonnet")) {
    return "claude-sonnet-4-6";
  }

  if (value.includes("claude")) {
    return "claude-sonnet-4-6";
  }

  return "claude-sonnet-4-6";
}

async function safeJson(response) {
  const raw =
    await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
