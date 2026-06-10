export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      message,
      messages,
      model,
      system,
      systemPrompt,
      history = [],
      maxTokens = 4096,
      temperature = 0.3
    } = req.body || {};

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: "ANTHROPIC_API_KEY is not configured"
      });
    }

    const finalMessages = buildClaudeMessages({
      message,
      messages,
      history
    });

    if (!finalMessages.length) {
      return res.status(400).json({
        error: "message or messages is required"
      });
    }

    const payload = {
      model: normalizeClaudeModel(model),
      max_tokens: maxTokens,
      temperature,
      messages: finalMessages
    };

    const finalSystem = systemPrompt || system;
    if (finalSystem) {
      payload.system = String(finalSystem);
    }

    const response = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Claude API Error",
        detail: data
