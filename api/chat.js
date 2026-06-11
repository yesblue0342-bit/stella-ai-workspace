export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    const model = String(body.model || "gpt-4o");
    const message = String(body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const system = String(body.system || "").trim();

    const search = body.search ?? "auto";
    const searchProvider = String(body.searchProvider || "auto");
    const searchType = String(body.searchType || "auto");

    if (!message) {
      return res.status(400).json({
        error: "message is required"
      });
    }

    const searchPayload = await prepareSearchContext({
      message,
      search,
      searchProvider,
      searchType
    });

    const enhancedSystem = buildEnhancedSystemPrompt(system, searchPayload);
    const enhancedMessage = buildEnhancedUserMessage(message, searchPayload);

    if (isClaudeModel(model)) {
      return await callClaude(res, {
        model,
        message: enhancedMessage,
        originalMessage: message,
        history,
        system: enhancedSystem,
        searchPayload
      });
    }

    return await callOpenAI(res, {
      model,
      message: enhancedMessage,
      originalMessage: message,
      history,
      system: enhancedSystem,
      searchPayload
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server Error"
    });
  }
}

function isClaudeModel(model) {
  return String(model || "")
    .toLowerCase()
    .includes("claude");
}

async function callOpenAI(res, { model, message, originalMessage, history, system, searchPayload }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      provider: "openai",
      error: "OPENAI_API_KEY not configured"
    });
  }

  const payload = {
    model: normalizeOpenAIModel(model),
    messages: buildOpenAIMessages(history, message, system),
    temperature: 0.3
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await safeJson(response);

  if (!response.ok) {
    return res.status(response.status).json({
      provider: "openai",
      error: data.error?.message || data.raw || "OpenAI Error",
      requestedModel: payload.model,
      detail: data,
      searchUsed: searchPayload.used,
      searchQuery: searchPayload.query,
      searchProvider: searchPayload.provider,
      searchType: searchPayload.type,
      searchResults: searchPayload.results,
      originalMessage
    });
  }

  return res.status(200).json({
    provider: "openai",
    model: data.model || payload.model,
    text: data.choices?.[0]?.message?.content || "응답 없음",
    usage: data.usage || null,
    searchUsed: searchPayload.used,
    searchQuery: searchPayload.query,
    searchProvider: searchPayload.provider,
    searchType: searchPayload.type,
    searchResults: searchPayload.results,
    originalMessage
  });
}

async function callClaude(res, { model, message, originalMessage, history, system, searchPayload }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      provider: "claude",
      error: "ANTHROPIC_API_KEY not configured"
    });
  }

  const payload = {
    model: normalizeClaudeModel(model),
    max_tokens: 4096,
    messages: buildClaudeMessages(history, message)
  };

  if (system) {
    payload.system = system;
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

  const data = await safeJson(response);

  if (!response.ok) {
    return res.status(response.status).json({
      provider: "claude",
      error: data.error?.message || data.raw || "Claude Error",
      requestedModel: payload.model,
      detail: data,
      searchUsed: searchPayload.used,
      searchQuery: searchPayload.query,
      searchProvider: searchPayload.provider,
      searchType: searchPayload.type,
      searchResults: searchPayload.results,
      originalMessage
    });
  }

  const text = Array.isArray(data.content)
    ? data.content
        .filter((item) => item.type === "text")
        .map((item) => item.text || "")
        .join("\n")
    : "";

  return res.status(200).json({
    provider: "claude",
    model: data.model || payload.model,
    text: text || "응답 없음",
    usage: data.usage || null,
    searchUsed: searchPayload.used,
    searchQuery: searchPayload.query,
    searchProvider: searchPayload.provider,
    searchType: searchPayload.type,
    searchResults: searchPayload.results,
    originalMessage
  });
}

function buildOpenAIMessages(history, message, system) {
  const messages = [];

  if (system) {
    messages.push({
      role: "system",
      content: String(system)
    });
  }

  for (const item of history) {
    if (!item || !item.content) continue;

    messages.push({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content)
    });
  }

  messages.push({
    role: "user",
    content: String(message)
  });

  return messages;
}

function buildClaudeMessages(history, message) {
  const messages = [];

  for (const item of history) {
    if (!item || !item.content) continue;

    const role = item.role === "assistant" ? "assistant" : "user";
    const content = String(item.content || "").trim();

    if (!content) continue;

    const last = messages[messages.length - 1];

    if (last && last.role === role) {
      last.content += "\n\n" + content;
    } else {
      messages.push({
        role,
        content
      });
    }
  }

  while (messages.length > 0 && messages[0].role === "assistant") {
    messages.shift();
  }

  messages.push({
    role: "user",
    content: String(message)
  });

  return messages;
}

async function prepareSearchContext({ message, search = "auto", searchProvider = "auto", searchType = "auto" }) {
  const shouldSearch =
    search === true ||
    search === "true" ||
    (String(search).toLowerCase() === "auto" && shouldUseSearch(message));

  if (!shouldSearch) {
    return {
      used: false,
      query: null,
      provider: null,
      type: null,
      results: [],
      context: ""
    };
  }

  const resolvedProvider = resolveSearchProvider(searchProvider);
  const resolvedType = searchType === "auto" ? detectSearchType(message) : searchType;
  const searchQuery = extractSearchQuery(message);

  let results = [];
  let searchError = null;

  try {
    if (resolvedProvider === "naver") {
      results = await searchNaver(searchQuery, resolvedType);
    } else {
      results = await searchNaver(searchQuery, resolvedType);
    }
  } catch (error) {
    searchError = error.message || "Search Error";
    results = [];
  }

  const limitedResults = removeDuplicateLinks(results).slice(0, 8);

  return {
    used: true,
    query: searchQuery,
    provider: resolvedProvider,
    type: resolvedType,
    results: limitedResults,
    error: searchError,
    context: buildSearchContext(limitedResults, searchError)
  };
}

function shouldUseSearch(message) {
  const text = String(message || "").toLowerCase();

  const keywords = [
    "검색",
    "찾아",
    "찾아봐",
    "찾아줘",
    "최신",
    "최근",
    "오늘",
    "뉴스",
    "기사",
    "속보",
    "현재",
    "블로그",
    "후기",
    "리뷰",
    "맛집",
    "여행",
    "숙소",
    "가격",
    "주가",
    "일정",
    "날씨",
    "공식",
    "문서",
    "api",
    "github",
    "오류",
    "error"
  ];

  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function resolveSearchProvider(searchProvider) {
  const requested = String(searchProvider || "auto").toLowerCase();

  if (requested === "naver" || requested === "auto") {
    return "naver";
  }

  return "naver";
}

function detectSearchType(message) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("뉴스") ||
    text.includes("기사") ||
    text.includes("속보") ||
    text.includes("최근") ||
    text.includes("오늘")
  ) {
    return "news";
  }

  if (
    text.includes("블로그") ||
    text.includes("후기") ||
    text.includes("리뷰") ||
    text.includes("맛집") ||
    text.includes("여행") ||
    text.includes("숙소")
  ) {
    return "blog";
  }

  return "web";
}

function extractSearchQuery(message) {
  let text = String(message || "").trim();

  const removeWords = [
    "오늘",
    "최근",
    "최신",
    "현재",
    "지금",
    "뉴스",
    "기사",
    "속보",
    "블로그",
    "후기",
    "리뷰",
    "검색해서",
    "검색해줘",
    "검색하고",
    "검색",
    "찾아서",
    "찾아줘",
    "찾아보고",
    "요약해서",
    "요약해줘",
    "요약",
    "정리해서",
    "정리해줘",
    "정리",
    "알려줘",
    "분석해줘",
    "설명해줘",
    "해줘",
    "해 봐",
    "해봐",
    "해"
  ];

  for (const word of removeWords) {
    text = text.replaceAll(word, " ");
  }

  text = text
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || String(message || "").trim();
}

function buildEnhancedSystemPrompt(system, searchPayload) {
  const baseSystem = String(system || "").trim();

  if (!searchPayload.used) {
    return baseSystem;
  }

  const searchInstruction = `
검색 결과가 제공된 경우 다음 원칙을 지켜 답변하세요.

1. 검색 결과를 우선 근거로 사용하세요.
2. 검색 결과에 없는 내용은 단정하지 마세요.
3. 최신 정보는 검색 결과 기준으로 설명하세요.
4. 검색 결과가 부족하면 부족하다고 말하세요.
5. 가능한 경우 마지막에 참고 링크를 간단히 정리하세요.
6. 뉴스는 날짜가 있는 항목을 우선 사용하세요.
`;

  if (baseSystem) {
    return `${baseSystem}\n\n${searchInstruction}`.trim();
  }

  return searchInstruction.trim();
}

function buildEnhancedUserMessage(message, searchPayload) {
  if (!searchPayload.used) {
    return String(message);
  }

  return `
사용자 질문:
${message}

검색어:
${searchPayload.query}

검색 Provider:
${searchPayload.provider}

검색 Type:
${searchPayload.type}

아래 네이버 검색 결과를 참고해서 답변해줘.
검색 결과에 없는 내용은 추측하지 말고, 필요한 경우 "검색 결과만으로는 부족하다"고 말해줘.

검색 결과:
${searchPayload.context}
`.trim();
}

function buildSearchContext(results, searchError = null) {
  if (searchError) {
    return `검색 API 오류: ${searchError}`;
  }

  if (!Array.isArray(results) || results.length === 0) {
    return "검색 결과 없음";
  }

  return results
    .map((item, index) => {
      return `[${index + 1}] ${item.title}\n출처: ${item.source}\nURL: ${item.link}\n요약: ${item.snippet}\n날짜: ${item.date || "없음"}`;
    })
    .join("\n\n");
}

async function searchNaver(query, type = "web") {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not configured");
  }

  const normalizedType = ["web", "news", "blog"].includes(type) ? type : "web";

  let apiUrl = "";

  if (normalizedType === "news") {
    apiUrl =
      "https://openapi.naver.com/v1/search/news.json" +
      `?query=${encodeURIComponent(query)}` +
      "&display=5" +
      "&start=1" +
      "&sort=date";
  } else if (normalizedType === "blog") {
    apiUrl =
      "https://openapi.naver.com/v1/search/blog.json" +
      `?query=${encodeURIComponent(query)}` +
      "&display=5" +
      "&start=1" +
      "&sort=sim";
  } else {
    apiUrl =
      "https://openapi.naver.com/v1/search/webkr.json" +
      `?query=${encodeURIComponent(query)}` +
      "&display=5" +
      "&start=1";
  }

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET
    }
  });

  const data = await safeJson(response);

  if (!response.ok) {
    throw new Error(data.errorMessage || data.message || data.raw || "Naver Search API Error");
  }

  return (data.items || []).map((item) => ({
    source: `naver_${normalizedType}`,
    title: removeHtml(item.title),
    link: item.originallink || item.link,
    snippet: removeHtml(item.description),
    date: item.pubDate || item.postdate || null
  }));
}

async function safeJson(response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function normalizeOpenAIModel(model) {
  const value = String(model || "").toLowerCase();

  if (value.includes("gpt-4.1-mini")) return "gpt-4.1-mini";
  if (value.includes("gpt-4.1")) return "gpt-4.1";
  if (value.includes("gpt-4o-mini")) return "gpt-4o-mini";
  if (value.includes("gpt-4o")) return "gpt-4o";
  if (value.includes("gpt-5")) return "gpt-4o";
  if (value.includes("chatgpt")) return "gpt-4o";

  return "gpt-4o";
}

function normalizeClaudeModel(model) {
  const value = String(model || "").toLowerCase();

  if (value.includes("opus")) return "claude-opus-4-8";
  if (value.includes("haiku")) return "claude-haiku-4-5-20251001";
  if (value.includes("sonnet")) return "claude-sonnet-4-6";
  if (value.includes("claude")) return "claude-sonnet-4-6";

  return "claude-sonnet-4-6";
}

function removeHtml(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function removeDuplicateLinks(results) {
  const seen = new Set();

  return results.filter((item) => {
    if (!item || !item.link) return false;

    if (seen.has(item.link)) {
      return false;
    }

    seen.add(item.link);
    return true;
  });
}
