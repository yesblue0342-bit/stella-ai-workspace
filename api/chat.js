import { detectSmartIntent, getSmartContextForMessage } from "../lib/place-weather-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const message = body.message || "";
    const history = Array.isArray(body.history) ? body.history : [];
    const model = body.model || "gpt-4o-mini";
    const system = body.system || "You are Stella GPT. Answer in Korean. Call the user KH.";

    const searchContext = await prepareSearchContext(message);
    const prompt = buildSystemPrompt(system, searchContext);

    const provider = model.includes("claude") ? "claude" : "openai";
    const answer = provider === "claude"
      ? await callClaude({ model, system: prompt, history, message })
      : await callOpenAI({ model, system: prompt, history, message });

    return res.status(200).json({ ok: true, text: answer, provider, searchContext });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "chat error" });
  }
}

async function prepareSearchContext(message) {
  try {
    const smart = detectSmartIntent(message);
    if (smart === "place" || smart === "weather") {
      return await getSmartContextForMessage(message);
    }
  } catch (error) {
    return { used: false, error: error.message };
  }
  return { used: false };
}

function buildSystemPrompt(system, searchContext) {
  let prompt = `${system}\n\nKH라고 부르고, 실무적으로 답하세요.`;
  if (searchContext?.used && searchContext.context) {
    prompt += `\n\n[실시간 컨텍스트]\n${searchContext.context}`;
  }
  return prompt;
}

async function callOpenAI({ model, system, history, message }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const selectedModel = model === "gpt-5.5" || model.includes("5.5") ? "gpt-4o" : model;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: selectedModel,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        ...history.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: String(message || "") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI API error");
  return data.choices?.[0]?.message?.content || "응답 없음";
}

async function callClaude({ model, system, history, message }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const selectedModel = model.includes("claude") ? "claude-3-5-sonnet-20241022" : model;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: 1600,
      system,
      messages: [
        ...history.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: String(message || "") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.map((c) => c.text || "").join("\n") || "응답 없음";
}
