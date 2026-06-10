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
      error: error.message
    });
  }
}

function detectProvider(model) {

  const value =
    String(model || "")
      .toLowerCase();

  if (
    value.includes("claude")
  ) {
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
      error:
        "OPENAI_API_KEY not configured"
    });
  }

  const messages = [];

  if (system) {
    messages.push({
      role: "system",
      content: system
    });
  }

  history.forEach(item => {

    if (!item?.content) {
      return;
    }

    messages.push({
      role:
        item.role === "assistant"
          ? "assistant"
          : "user",
      content: item.content
    });

  });

  messages.push({
    role: "user",
    content: message
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
            normalizeOpenAIModel(
              model
            ),
          messages,
          temperature: 0.3
        })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    return res.status(
      response.status
    ).json({
      error:
        data.error?.message ||
        "OpenAI Error"
    });
  }

  return res.status(200).json({
    provider: "openai",
    model: data.model,
    text:
      data.choices?.[0]
        ?.message?.content || ""
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
      error:
        "ANTHROPIC_API_KEY not configured"
    });
  }

  const messages = [];

  history.forEach(item => {

    if (!item?.content) {
      return;
    }

    messages.push({
      role:
        item.role === "assistant"
          ? "assistant"
          : "user",
      content: item.content
    });

  });

  messages.push({
    role: "user",
    content: message
  });

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
        body: JSON.stringify({
          model:
            "claude-3-5-sonnet-20241022",
          max_tokens: 4096,
          messages,
          system
        })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    return res.status(
      response.status
    ).json({
      error:
        data.error?.message ||
        "Claude Error"
    });
  }

  const text =
    Array.isArray(
      data.content
    )
      ? data.content
          .map(
            item =>
              item.text || ""
          )
          .join("\n")
      : "";

  return res.status(200).json({
    provider: "claude",
    model: data.model,
    text
  });
}

function normalizeOpenAIModel(
  model
) {

  const value =
    String(model || "")
      .toLowerCase();

  if (
    value.includes(
      "gpt-4.1-mini"
    )
  ) {
    return "gpt-4.1-mini";
  }

  if (
    value.includes(
      "gpt-4.1"
    )
  ) {
    return "gpt-4.1";
  }

  if (
    value.includes(
      "gpt-4o-mini"
    )
  ) {
    return "gpt-4o-mini";
  }

  if (
    value.includes(
      "gpt-5"
    )
  ) {
    return "gpt-4o";
  }

  return "gpt-4o";
}
