export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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
      return res.status(400).json({ error: "message is required" });
    }

    const searchPayload = await prepareSearchContext({
      message,
      search,
      searchProvider,
      searchType
    });

    const enhancedSystem = buildEnhancedSystemPrompt(system, searchPayload, message);
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
    return res.status(500).json({ error: error.message || "Server Error" });
  }
}

function isClaudeModel(model) {
  return String(model || "").toLowerCase().includes("claude");
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
    temperature: 0.35
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
      ...searchMeta(searchPayload),
      originalMessage
    });
  }

  return res.status(200).json({
    provider: "openai",
    model: data.model || payload.model,
    text: data.choices?.[0]?.message?.content || "응답 없음",
    usage: data.usage || null,
    ...searchMeta(searchPayload),
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

  if (system) payload.system = system;

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
      ...searchMeta(searchPayload),
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
    ...searchMeta(searchPayload),
    originalMessage
  });
}

function searchMeta(searchPayload) {
  return {
    searchUsed: searchPayload.used,
    searchQuery: searchPayload.query,
    searchProvider: searchPayload.provider,
    searchType: searchPayload.type,
    searchIntent: searchPayload.intent,
    searchResults: searchPayload.results,
    searchError: searchPayload.error || null
  };
}

function buildOpenAIMessages(history, message, system) {
  const messages = [];

  if (system) {
    messages.push({ role: "system", content: String(system) });
  }

  for (const item of history) {
    if (!item || !item.content) continue;
    messages.push({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content)
    });
  }

  messages.push({ role: "user", content: String(message) });
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
      messages.push({ role, content });
    }
  }

  while (messages.length > 0 && messages[0].role === "assistant") {
    messages.shift();
  }

  messages.push({ role: "user", content: String(message) });
  return messages;
}

async function prepareSearchContext({ message, search = "auto", searchProvider = "auto", searchType = "auto" }) {
  const intent = detectIntent(message);
  const shouldSearch =
    search === true ||
    search === "true" ||
    (String(search).toLowerCase() === "auto" && shouldUseSearch(message));

  if (!shouldSearch) {
    return emptySearchPayload(intent);
  }

  const resolvedProvider = resolveSearchProvider(message, searchProvider, intent);
  const resolvedType = String(searchType || "auto") === "auto" ? detectSearchType(message, intent) : String(searchType || "web");
  const searchQuery = extractSearchQuery(message, intent);

  let results = [];
  let searchError = null;

  try {
    results = await runSearchProvider({ provider: resolvedProvider, query: searchQuery, type: resolvedType, intent });
  } catch (error) {
    searchError = error.message || "Search Error";
    results = [];
  }

  const limitedResults = removeDuplicateLinks(results).slice(0, 10);

  return {
    used: true,
    query: searchQuery,
    provider: resolvedProvider,
    type: resolvedType,
    intent,
    results: limitedResults,
    error: searchError,
    context: buildSearchContext(limitedResults, searchError)
  };
}

function emptySearchPayload(intent = "general") {
  return {
    used: false,
    query: null,
    provider: null,
    type: null,
    intent,
    results: [],
    error: null,
    context: ""
  };
}

async function runSearchProvider({ provider, query, type, intent }) {
  if (intent === "local_food") {
    const naverBlog = await safeSearch(() => searchNaver(query, "blog"));
    const naverWeb = await safeSearch(() => searchNaver(query, "web"));
    const googleWeb = await safeSearch(() => searchGoogle(query));
    return removeDuplicateLinks([...naverBlog, ...naverWeb, ...googleWeb]);
  }

  if (provider === "google") return await searchGoogle(query);
  if (provider === "wiki" || provider === "wikipedia") return await searchWikipedia(query);
  if (provider === "namu" || provider === "namuwiki") return await searchNamuWiki(query);

  if (provider === "knowledge") {
    const [wikiResults, namuResults] = await Promise.all([
      safeSearch(() => searchWikipedia(query)),
      safeSearch(() => searchNamuWiki(query))
    ]);
    return removeDuplicateLinks([...wikiResults, ...namuResults]);
  }

  if (provider === "all") {
    const [naverResults, googleResults, wikiResults, namuResults] = await Promise.all([
      safeSearch(() => searchNaver(query, type)),
      safeSearch(() => searchGoogle(query)),
      safeSearch(() => searchWikipedia(query)),
      safeSearch(() => searchNamuWiki(query))
    ]);
    return removeDuplicateLinks([...naverResults, ...googleResults, ...wikiResults, ...namuResults]);
  }

  return await searchNaver(query, type);
}

async function safeSearch(fn) {
  try {
    return await fn();
  } catch {
    return [];
  }
}

function detectIntent(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("맛집") || text.includes("식당") || text.includes("밥집") || text.includes("카페") || text.includes("먹을")) return "local_food";
  if (/#db|#sap|#stellagpt|구글\s*드라이브|knowledge|내\s*문서|자료\s*기준|폴더에서/i.test(text)) return "drive_knowledge";
  return "general";
}

function shouldUseSearch(message) {
  const text = String(message || "").toLowerCase();
  const keywords = [
    "검색", "찾아", "찾아봐", "찾아줘", "최신", "최근", "이번 달", "오늘", "뉴스", "기사", "속보", "현재",
    "블로그", "후기", "리뷰", "맛집", "식당", "카페", "여행", "숙소", "가격", "주가", "일정", "날씨",
    "공식", "문서", "api", "github", "오류", "error", "구글", "google", "네이버", "naver", "위키",
    "위키백과", "wikipedia", "나무위키", "namu", "프로필", "인물", "작가", "소설가", "뜻", "정의", "누구", "무엇", "정보", "#db", "#sap", "#stellagpt"
  ];
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function resolveSearchProvider(message, searchProvider, intent) {
  const requested = String(searchProvider || "auto").toLowerCase();
  if (["naver", "google", "wiki", "wikipedia", "namu", "namuwiki", "knowledge", "all"].includes(requested)) {
    return requested === "wikipedia" ? "wiki" : requested === "namuwiki" ? "namu" : requested;
  }

  const text = String(message || "").toLowerCase();
  const wantsWiki = text.includes("위키백과") || text.includes("wikipedia");
  const wantsNamu = text.includes("나무위키") || text.includes("namu");
  const wantsGoogle = text.includes("구글") || text.includes("google");
  const wantsNaver = text.includes("네이버") || text.includes("naver");

  if (intent === "local_food") return "all";
  if ((wantsWiki && wantsNamu) || text.includes("지식검색") || text.includes("knowledge")) return "knowledge";
  if ((wantsGoogle && wantsNaver) || text.includes("전체 검색") || text.includes("통합 검색")) return "all";
  if (wantsGoogle) return "google";
  if (wantsWiki) return "wiki";
  if (wantsNamu) return "namu";
  if (text.includes("프로필") || text.includes("인물") || text.includes("작가") || text.includes("소설가") || text.includes("뜻") || text.includes("정의") || text.includes("누구") || text.includes("무엇")) return "knowledge";
  return "naver";
}

function detectSearchType(message, intent) {
  const text = String(message || "").toLowerCase();
  if (intent === "local_food") return "local_food";
  if (text.includes("뉴스") || text.includes("기사") || text.includes("속보") || text.includes("최근") || text.includes("오늘") || text.includes("이번 달")) return "news";
  if (text.includes("블로그") || text.includes("후기") || text.includes("리뷰") || text.includes("맛집") || text.includes("여행") || text.includes("숙소")) return "blog";
  return "web";
}

function extractSearchQuery(message, intent) {
  let text = String(message || "").trim();
  const removeWords = [
    "오늘", "최근", "최신", "현재", "지금", "이번 달", "이번달", "뉴스", "기사", "속보", "블로그", "후기", "리뷰",
    "구글", "google", "네이버", "naver", "위키백과", "wikipedia", "나무위키", "namu", "위키", "지식검색", "knowledge",
    "검색해서", "검색해줘", "검색하고", "검색", "찾아서", "찾아줘", "찾아보고", "요약해서", "요약해줘", "요약",
    "한 문단으로", "한문단으로", "정리해서", "정리해줘", "정리", "알려줘", "분석해줘", "설명해줘"
  ];

  for (const word of removeWords) {
    text = text.replaceAll(word, " ");
  }

  text = text.replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();

  if (intent === "local_food" && !/인천|송도|연수구|한라웨스턴파크/.test(text)) {
    text = `${text} 인천 송도 맛집`;
  }

  return text || String(message || "").trim();
}

function buildEnhancedSystemPrompt(system, searchPayload, originalMessage) {
  const baseSystem = String(system || "").trim();
  const stellaSystem = `
당신은 Stella GPT입니다. 사용자의 질문 의도를 먼저 파악하고, ChatGPT처럼 자연스럽고 실용적으로 답변하세요.
답변은 한국어로 하며, 불필요하게 검색 결과 원문을 길게 붙여넣지 마세요.
사용자가 추천을 요청하면 결론을 먼저 말하고, 상황별 추천과 이유를 간단히 정리하세요.
`.trim();

  if (!searchPayload.used) {
    return [baseSystem, stellaSystem].filter(Boolean).join("\n\n");
  }

  const searchInstruction = `
검색 결과가 제공된 경우 다음 원칙을 지켜 답변하세요.

1. 검색 결과는 근거로만 사용하고, 검색 결과 목록을 그대로 복사하지 마세요.
2. 사용자가 원하는 것은 링크 모음이 아니라 판단과 추천입니다. 먼저 결론을 말하세요.
3. 검색 결과가 부족하거나 상가 임대글, 광고성 글처럼 질문과 맞지 않으면 제외하거나 신뢰도를 낮게 보세요.
4. 최신 정보는 변동될 수 있으므로 영업시간, 휴무, 평점은 방문 전 지도에서 확인하라고 짧게 안내하세요.
5. 마지막에 참고 링크는 2~4개만 간단히 정리하세요.
`.trim();

  const localFoodInstruction = searchPayload.intent === "local_food" ? `
맛집/식당 추천 질문입니다.
- "검색 결과를 바탕으로" 같은 말로 시작하지 말고 바로 추천하세요.
- 기준 위치를 중심으로 "바로 근처", "차로 5~10분", "가볍게", "제대로 식사"처럼 사용자가 선택하기 쉽게 묶으세요.
- 가능하면 표 형태로 상황 / 추천 / 이유를 정리하세요.
- 거리와 영업 여부는 검색 결과만으로 확정하지 말고 "지도 확인 필요"라고 짧게 덧붙이세요.
- 검색 결과가 애매하면, 애매하다고 말한 뒤 일반적인 선택 기준을 제안하세요.
`.trim() : "";

  const driveInstruction = searchPayload.intent === "drive_knowledge" ? `
Google Drive/Knowledge 검색 요청입니다.
#DB, #SAP, #StellaGPT 같은 태그가 있으면 사용자가 내부 자료 검색을 원한다는 뜻입니다.
검색 결과가 없으면 내부 자료가 아직 연결되지 않았거나 배포 전일 수 있다고 안내하세요.
`.trim() : "";

  return [baseSystem, stellaSystem, searchInstruction, localFoodInstruction, driveInstruction].filter(Boolean).join("\n\n");
}

function buildEnhancedUserMessage(message, searchPayload) {
  if (!searchPayload.used) return String(message);

  return `
사용자 질문:
${message}

검색어:
${searchPayload.query}

검색 Provider:
${searchPayload.provider}

검색 Type:
${searchPayload.type}

검색 Intent:
${searchPayload.intent}

아래 검색 결과를 참고해서 사용자가 바로 이해하고 선택할 수 있게 답변해줘.
검색 결과를 그대로 나열하지 말고, 질문 의도에 맞게 선별해서 요약해줘.

검색 결과:
${searchPayload.context}
`.trim();
}

function buildSearchContext(results, searchError = null) {
  if (searchError) return `검색 API 오류: ${searchError}`;
  if (!Array.isArray(results) || results.length === 0) return "검색 결과 없음";

  return results
    .map((item, index) => `[${index + 1}] ${item.title}\n출처: ${item.source}\nURL: ${item.link}\n요약: ${item.snippet}\n날짜: ${item.date || "없음"}`)
    .join("\n\n");
}

async function searchNaver(query, type = "web") {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not configured");
  }

  const normalizedType = ["web", "news", "blog"].includes(type) ? type : "web";
  let path = "webkr";
  let sort = "";

  if (normalizedType === "news") {
    path = "news";
    sort = "&sort=date";
  } else if (normalizedType === "blog") {
    path = "blog";
    sort = "&sort=sim";
  }

  const apiUrl =
    `https://openapi.naver.com/v1/search/${path}.json` +
    `?query=${encodeURIComponent(query)}` +
    "&display=8" +
    "&start=1" +
    sort;

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET
    }
  });

  const data = await safeJson(response);
  if (!response.ok) throw new Error(data.errorMessage || data.message || data.raw || "Naver Search API Error");

  return (data.items || []).map((item) => ({
    source: `naver_${normalizedType}`,
    title: removeHtml(item.title),
    link: item.originallink || item.link || "",
    snippet: removeHtml(item.description),
    date: item.pubDate || item.postdate || null
  }));
}

async function searchGoogle(query) {
  if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CX) {
    throw new Error("GOOGLE_API_KEY or GOOGLE_CX not configured");
  }

  const apiUrl =
    "https://www.googleapis.com/customsearch/v1" +
    `?key=${encodeURIComponent(process.env.GOOGLE_API_KEY)}` +
    `&cx=${encodeURIComponent(process.env.GOOGLE_CX)}` +
    `&q=${encodeURIComponent(query)}` +
    "&num=8";

  const response = await fetch(apiUrl, { method: "GET" });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(data.error?.message || data.raw || "Google Search API Error");

  return (data.items || []).map((item) => ({
    source: "google_web",
    title: removeHtml(item.title),
    link: item.link || "",
    snippet: removeHtml(item.snippet),
    date: null
  }));
}

async function searchWikipedia(query) {
  const searchUrl =
    "https://ko.wikipedia.org/w/api.php" +
    "?action=query" +
    "&list=search" +
    "&format=json" +
    "&origin=*" +
    `&srsearch=${encodeURIComponent(query)}` +
    "&srlimit=5";

  const response = await fetch(searchUrl, {
    method: "GET",
    headers: { "User-Agent": "StellaGPT/1.0" }
  });

  const data = await safeJson(response);
  if (!response.ok) throw new Error(data.raw || "Wikipedia API Error");

  const items = data.query?.search || [];
  return items.map((item) => {
    const title = item.title || "";
    return {
      source: "wikipedia_ko",
      title: removeHtml(title),
      link: "https://ko.wikipedia.org/wiki/" + encodeURIComponent(title.replaceAll(" ", "_")),
      snippet: removeHtml(item.snippet),
      date: item.timestamp || null
    };
  });
}

async function searchNamuWiki(query) {
  const naverResults = await safeSearch(async () => {
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return [];
    const namuQuery = `${query} site:namu.wiki`;
    const apiUrl =
      "https://openapi.naver.com/v1/search/webkr.json" +
      `?query=${encodeURIComponent(namuQuery)}` +
      "&display=5" +
      "&start=1";

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET
      }
    });
    const data = await safeJson(response);
    if (!response.ok) return [];
    return (data.items || [])
      .filter((item) => String(item.link || "").includes("namu.wiki"))
      .map((item) => ({
        source: "namu_wiki",
        title: removeHtml(item.title),
        link: item.link || "",
        snippet: removeHtml(item.description),
        date: null
      }));
  });

  if (naverResults.length > 0) return naverResults;

  const googleResults = await safeSearch(() => searchGoogle(`${query} site:namu.wiki`));
  return googleResults
    .filter((item) => String(item.link || "").includes("namu.wiki"))
    .map((item) => ({ ...item, source: "namu_wiki" }));
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
  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function removeDuplicateLinks(results) {
  const seen = new Set();
  return results.filter((item) => {
    if (!item || !item.link) return false;
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}
