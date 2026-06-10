export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      message,
      model,
      system,
      history = []
    } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not configured"
      });
    }

    if (!message) {
      return res.status(400).json({
        error: "message is required"
      });
    }

    const safeModel = normalizeOpenAIModel(model);

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
          role: item.role === "assistant" ? "assistant" : "user",
          content: String(item.content)
        });
      });
    }

    messages.push({
      role: "user",
      content: String(message)
    });

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: safeModel,
          messages,
          temperature: 0.3
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "OpenAI API Error",
        detail: data
      });
    }

    return res.status(200).json({
      text: data.choices?.[0]?.message?.content || "응답 없음",
      model: data.model,
      usage: data.usage
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server Error"
    });
  }
}

function normalizeOpenAIModel(model) {
  const value = String(model || "").toLowerCase();

  if (value.includes("gpt-5.5")) {
    return "gpt-4o";
  }

  if (value.includes("chatgpt-5.3")) {
    return "gpt-4o";
  }

  if (value.includes("gpt-4o-mini")) {
    return "gpt-4o-mini";
  }

  if (value.includes("gpt-4.1-mini")) {
    return "gpt-4.1-mini";
  }

  if (value.includes("gpt-4.1")) {
    return "gpt-4.1";
  }

  if (value.includes("gpt-4o")) {
    return "gpt-4o";
  }

  return "gpt-4o";
}
