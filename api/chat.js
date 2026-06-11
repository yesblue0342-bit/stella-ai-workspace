export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      model = "gpt-4o",
      message,
      history = [],
      system = "",
      search = "auto",
      searchProvider = "auto",
      searchType = "auto"
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "message is required"
      });
    }

    const searchPayload = await prepareSearchContext(req, {
      message,
      search,
      searchProvider,
      searchType
    });

    const enhancedMessage = buildEnhancedUserMessage(message, searchPayload);
    const enhancedSystem = buildEnhancedSystemPrompt(system, searchPayload);

    if (isClaudeModel(model)) {
      return await handleClaude(res, {
        model,
        message: enhancedMessage,
        history,
        system: enhancedSystem,
        searchPayload
      });
    }

    return await handleOpenAI(res, {
      model,
      message: enhancedMessage,
      history,
      system: enhancedSystem,
      searchPayload
    });
  } catch (error) {
    console.error("[chat] unhandled error:", error);
    return res.status(500).json({
      error: error.message || "Server Error"
    });
  }
}

// ─── Model helpers ────────────────────────────────────────────────────────────

function isClaudeModel(model) {
  return String(model || "")
    .toLowerCase()
    .includes("claude");
}

function normalizeOpenAIModel(model) {
  const v = String(model || "").toLowerCase();

  if (v.includes("gpt-4.1-mini")) return "gpt-4.1-mini";
  if (v.includes("gpt-4.1"))      return "gpt-4.1";
  if (v.includes("gpt-4o-mini"))  return "gpt-4o-mini";
  if (v.includes("gpt-4o"))       return "gpt-4o";
  // gpt-5, gpt-5.5 등 미지원 최신 모델명 → gpt-4o fallback
  if (v.includes("gpt-5"))        return "gpt-4o";
  if (v.includes("chatgpt"))      return "gpt-4o";

  return "gpt-4o";
}

function normalizeClaudeModel(model) {
  const v = String(model || "").toLowerCase();

  if (v.includes("opus"))   return "claude-opus-4-8";
  if (v.includes("haiku"))  return "claude-haiku-4-5-20251001";
  if (v.includes("sonnet")) return "claude-sonnet-4-6";
  if (v.includes("claude")) return "claude-sonnet-4-6";

  return "claude-sonnet-4-6";
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildOpenAIMessages(history, message, system) {
  const messages = [];

  if (system) {
    messages.push({ role: "system", content: String(system) });
  }

  if (Array.isArray(history)) {
    history.forEach((item) => {
      if (!item || !item.content) return;
      messages.push({
        role: item.role === "assistant" ? "assistant" : "user",
        content: String(item.content)
      });
    });
  }

  messages.push({ role: "user", content: String(message) });
  return messages;
}

function buildClaudeMessages(history, message) {
  const messages = [];

  if (Array.isArray(history)) {
    history.forEach((item) => {
      if (!item || !item.content) return;

      const role    = item.role === "assistant" ? "assistant" : "user";
      const content = String(item.content || "").trim();
      if (!content) return;

      const last = messages[messages.length - 1];
      if (last && last.role === role) {
        last.content += "\n\n" + content;
      } else {
        messages.push({ role, content });
      }
    });
  }

  // Claude는 user 턴으로 시작해야 함
  while (messages.length > 0 && messages[0].role === "assistant") {
    messages.shift();
  }

  messages.push({ role: "user", content: String(message) });
  return messages;
}

// ─── Provider handlers ────────────────────────────────────────────────────────

async function handleOpenAI(res, { model, message, history, system, searchPayload }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      provider: "openai",
      error: "OPENAI_API_KEY not configured"
    });
  }

  const normalizedModel = normalizeOpenAIModel(model);

  const payload = {
    model: normalizedModel,
    messages: buildOpenAIMessages(history, message, system),
    temperature: 0.3
  };

  let response, data;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    data = await safeJson(response);
  } catch (err) {
    console.error("[openai] fetch error:", err);
    return res.status(502).json({
      provider: "openai",
      error: "OpenAI API 연결 실패: " + (err.message || "network error")
    });
  }

  if (!response.ok) {
    return res.status(response.status).json({
      provider: "openai",
      error: data.error?.message || data.raw || "OpenAI Error",
      requestedModel: normalizedModel,
      detail: data
    });
  }

  return res.status(200).json({
    provider: "openai",
    model: data.model,
    text: data.choices?.[0]?.message?.content || "응답 없음",
    usage: data.usage,
    searchUsed: searchPayload.used,
    searchQuery: searchPayload.query,
    searchProvider: searchPayload.provider,
    searchType: searchPayload.type,
    searchResults: searchPayload.results
  });
}

async function handleClaude(res, { model, message, history, system, searchPayload }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      provider: "claude",
      error: "ANTHROPIC_API_KEY not configured"
    });
  }

  const normalizedModel = normalizeClaudeModel(model);

  const payload = {
    model: normalizedModel,
    max_tokens: 4096,
    messages: buildClaudeMessages(history, message)
  };

  if (system) {
    payload.system = String(system);
  }

  let response, data;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    });
    data = await safeJson(response);
  } catch (err) {
    console.error("[claude] fetch error:", err);
    return res.status(502).json({
      provider: "claude",
      error: "Claude API 연결 실패: " + (err.message || "network error")
    });
  }

  if (!response.ok) {
    return res.status(response.status).json({
      provider: "claude",
      error: data.error?.message || data.raw || "Claude Error",
      requestedModel: normalizedModel,
      detail: data
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
    model: data.model,
    text: text || "응답 없음",
    usage: data.usage,
    searchUsed: searchPayload.used,
    searchQuery: searchPayload.query,
    searchProvider: searchPayload.provider,
    searchType: searchPayload.type,
    searchResults: searchPayload.results
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function prepareSearchContext(req, { message, search = "auto", searchProvider = "auto", searchType = "auto" }) {
  const shouldSearch =
    search === true ||
    search === "true" ||
    (search === "auto" && shouldUseSearch(message));

  if (!shouldSearch) {
    return { used: false, query: null, provider: null, type: null, results: [], context: "" };
  }

  const provider = resolveSearchProvider(message, searchProvider);
  const type     = searchType === "auto" ? detectSearchType(message) : searchType;
  const query    = extractSearchQuery(message);

  const results = await callSearchApi(req, { query, provider, type });
  const limitedResults = results.slice(0, 10);

  return {
    used: true,
    query,
    provider,
    type,
    results: limitedResults,
    context: buildSearchContext(limitedResults)
  };
}

async function callSearchApi(req, { query, provider, type }) {
  try {
    const baseUrl = getBaseUrl(req);

    const url =
      `${baseUrl}/api/search` +
      `?q=${encodeURIComponent(query)}` +
      `&provider=${encodeURIComponent(provider)}` +
      `&type=${encodeURIComponent(type)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        // 내부 호출임을 명시 (일부 미들웨어 우회)
        "x-internal-request": "1"
      }
    });

    if (!response.ok) {
      console.warn("[search] API returned", response.status, "for query:", query);
      return [];
    }

    const data = await safeJson(response);
    return Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    // 검색 실패는 치명적이지 않으므로 빈 배열로 graceful fallback
    console.warn("[search] callSearchApi failed:", err?.message || err);
    return [];
  }
}

/**
 * Vercel 배포 환경에서 올바른 base URL을 반환합니다.
 * 우선순위: VERCEL_URL 환경변수 → x-forwarded 헤더 → host 헤더
 */
function getBaseUrl(req) {
  // Vercel 환경변수 우선
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  const host  = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const proto = req.headers["x-forwarded-proto"] || "https";

  return `${proto}://${host}`;
}

// ─── Search helpers ───────────────────────────────────────────────────────────

function shouldUseSearch(message) {
  const text = String(message || "").toLowerCase();

  const keywords = [
    "검색", "찾아", "최신", "최근", "오늘", "뉴스", "기사", "현재",
    "가격", "주가", "일정", "날씨", "맛집", "여행", "추천", "공식",
    "문서", "api", "documentation", "docs", "github", "error", "오류",
    "2026", "위키", "위키백과", "나무위키", "프로필", "인물", "작가",
    "소설가", "뜻", "정의", "누구", "무엇", "정보"
  ];

  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

function resolveSearchProvider(message, searchProvider) {
  const requested = String(searchProvider || "auto").toLowerCase();
  if (requested !== "auto") return requested;

  const text = String(message || "").toLowerCase();

  if (
    (text.includes("위키백과") && text.includes("나무위키")) ||
    (text.includes("위키") && text.includes("나무"))
  ) return "knowledge";

  if (
    text.includes("프로필") || text.includes("인물") ||
    text.includes("작가")   || text.includes("소설가") ||
    text.includes("뜻")     || text.includes("정의") ||
    text.includes("누구")   || text.includes("무엇")
  ) return "knowledge";

  if (text.includes("나무위키") || text.includes("namu")) return "namu";
  if (text.includes("위키백과") || text.includes("wikipedia") || text.includes("wiki")) return "wiki";

  return "naver";
}

function detectSearchType(message) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("뉴스") || text.includes("기사") ||
    text.includes("속보") || text.includes("최근") || text.includes("오늘")
  ) return "news";

  if (
    text.includes("블로그") || text.includes("후기") ||
    text.includes("맛집")   || text.includes("여행") ||
    text.includes("숙소")   || text.includes("리뷰")
  ) return "blog";

  return "web";
}

function extractSearchQuery(message) {
  let text = String(message || "").trim();

  const removeWords = [
    "오늘", "최근", "최신", "현재", "지금", "뉴스", "기사", "속보",
    "블로그", "후기", "리뷰", "위키백과", "나무위키", "위키",
    "wikipedia", "namu", "knowledge",
    "검색해서", "검색해줘", "검색하고", "검색",
    "찾아서", "찾아줘", "찾아보고",
    "요약해서", "요약해줘", "요약",
    "정리해서", "정리해줘", "정리",
    "알려줘", "분석해줘", "설명해줘", "해줘", "해 봐", "해봐", "해"
  ];

  removeWords.forEach((word) => {
    text = text.replaceAll(word, " ");
  });

  text = text.replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();

  return text || String(message || "").trim();
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildEnhancedSystemPrompt(system, searchPayload) {
  const baseSystem = String(system || "").trim();

  if (!searchPayload.used) return baseSystem;

  const searchInstruction = `
검색 결과가 제공된 경우 다음 원칙을 지켜 답변하세요.

1. 검색 결과를 우선 근거로 사용하세요.
2. 검색 결과에 없는 내용은 단정하지 마세요.
3. 최신 정보는 검색 결과 기준으로 설명하세요.
4. 가능한 경우 답변 마지막에 참고 링크를 정리하세요.
5. 검색 결과가 부족하면 부족하다고 말하세요.
6. 위키백과와 나무위키 결과는 참고자료로 사용하되, 서로 다른 내용이 있으면 차이를 구분해서 설명하세요.
`.trim();

  return baseSystem ? `${baseSystem}\n\n${searchInstruction}` : searchInstruction;
}

function buildEnhancedUserMessage(message, searchPayload) {
  if (!searchPayload.used || !searchPayload.context) {
    return String(message);
  }

  return `사용자 질문:
${message}

검색어:
${searchPayload.query}

검색 Provider:
${searchPayload.provider}

아래 검색 결과를 참고해서 답변해줘.
검색 결과에 없는 내용은 추측하지 말고, 필요한 경우 "검색 결과만으로는 부족하다"고 말해줘.

검색 결과:
${searchPayload.context}`.trim();
}

function buildSearchContext(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "검색 결과 없음";
  }

  return results
    .map((item, index) => `[${index + 1}] ${item.title}
출처: ${item.source}
URL: ${item.link}
요약: ${item.snippet}
날짜: ${item.date || "없음"}`)
    .join("\n\n");
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function safeJson(response) {
  try {
    const raw = await response.text();
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  } catch {
    return { raw: "" };
  }
}
