export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      model,
      message,
      history = [],
      system = ""
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "message is required"
      });
    }

    const provider = detectProvider(model);

    if (provider === "claude") {
      return await handleClaude(
        res,
        model,
        message,
        history,
        system
      );
    }

    return await handleOpenAI(
      res,
      model,
      message,
      history,
      system
    );

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server Error"
    });
  }
}

function detectProvider(model) {
  const value =
    String(model || "")
      .toLowerCase();

  if (value.includes("claude")) {
    return "claude";
  }

  return "openai";
}

async function handleOpenAI(
  res,
  model,
  message,
  history,
  system
) {
  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      provider: "openai",
      error: "OPENAI_API_KEY not configured"
    });
  }

  const messages = [];

  if (system) {
    messages.push({
      role: "system",
      content: String(system)
    });
  }

  if (Array.isArray(history)) {
    history.forEach(item => {
      if (!item || !item.content) return;

      messages.push({
        role:
          item.role === "assistant"
            ? "assistant"
            : "user",
        content: String(item.content)
      });
    });
  }

  messages.push({
    role: "user",
    content: String(message)
  });

  const response =
    await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model:
            normalizeOpenAIModel(model),
          messages,
          temperature: 0.3
        })
      }
    );

  const raw =
    await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    return res.status(response.status).json({
      provider: "openai",
      error:
        data.error?.message ||
        raw ||
        "OpenAI Error",
      detail: data
    });
  }

  return res.status(200).json({
    provider: "openai",
    model: data.model,
    text:
      data.choices?.[0]
        ?.message?.content || "응답 없음",
    usage: data.usage
  });
}

async function handleClaude(
  res,
  model,
  message,
  history,
  system
) {
  const apiKey =
    process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      provider: "claude",
      error: "ANTHROPIC_API_KEY not configured"
    });
  }

  const messages = [];

  if (Array.isArray(history)) {
    history.forEach(item => {
      if (!item || !item.content) return;

      const role =
        item.role === "assistant"
          ? "assistant"
          : "user";

      const content =
        String(item.content || "").trim();

      if (!content) return;

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

  messages.push({
    role: "user",
    content: String(message)
  });

  while (messages.length > 0 && messages[0].role === "assistant") {
    messages.shift();
  }

  const payload = {
    model:
      normalizeClaudeModel(model),
    max_tokens: 4096,
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
          "Content-Type":
            "application/json",
          "x-api-key":
            apiKey,
          "anthropic-version":
            "2023-06-01"
        },
        body: JSON.stringify(payload)
      }
    );

  const raw =
    await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    return res.status(response.status).json({
      provider: "claude",
      error:
        data.error?.message ||
        raw ||
        "Claude Error",
      requestedModel:
        payload.model,
      detail: data
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
}

function normalizeOpenAIModel(model) {
  const value =
    String(model || "")
      .toLowerCase();

  if (value.includes("gpt-4.1-mini")) {
    return "gpt-4.1-mini";
  }

  if (value.includes("gpt-4.1")) {
    return "gpt-4.1";
  }

  if (value.includes("gpt-4o-mini")) {
    return "gpt-4o-mini";
  }

  if (value.includes("gpt-4o")) {
    return "gpt-4o";
  }

  if (value.includes("gpt-5")) {
    return "gpt-4o";
  }

  if (value.includes("chatgpt-5")) {
    return "gpt-4o";
  }

  return "gpt-4o";
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
