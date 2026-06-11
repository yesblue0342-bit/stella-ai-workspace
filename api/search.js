export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const query = String(req.query.q || "").trim();
    const type = String(req.query.type || "web").toLowerCase();
    const provider = String(req.query.provider || "naver").toLowerCase();

    if (!query) {
      return res.status(400).json({
        error: "검색어가 없습니다.",
        results: []
      });
    }

    const results = await runSearch({
      query,
      type,
      provider
    });

    return res.status(200).json({
      query,
      provider,
      type,
      count: results.length,
      results
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Search API Server Error",
      results: []
    });
  }
}

async function runSearch({ query, type, provider }) {
  if (provider === "naver" || provider === "auto") {
    return await searchNaver(query, type);
  }

  if (provider === "google") {
    return await searchGoogle(query);
  }

  if (provider === "wiki" || provider === "wikipedia") {
    return await searchWikipedia(query);
  }

  if (provider === "namu" || provider === "namuwiki") {
    return await searchNamuWiki(query);
  }

  if (provider === "knowledge") {
    const wikiResults = await searchWikipedia(query);
    const namuResults = await searchNamuWiki(query);

    return removeDuplicateLinks([
      ...wikiResults,
      ...namuResults
    ]);
  }

  if (provider === "all") {
    const naverResults = await searchNaver(query, type);
    const googleResults = await searchGoogle(query);
    const wikiResults = await searchWikipedia(query);
    const namuResults = await searchNamuWiki(query);

    return removeDuplicateLinks([
      ...naverResults,
      ...googleResults,
      ...wikiResults,
      ...namuResults
    ]);
  }

  return [];
}

async function searchNaver(query, type = "web") {
  if (
    !process.env.NAVER_CLIENT_ID ||
    !process.env.NAVER_CLIENT_SECRET
  ) {
    return [];
  }

  let path = "webkr";
  let sort = "";

  if (type === "news") {
    path = "news";
    sort = "&sort=date";
  } else if (type === "blog") {
    path = "blog";
    sort = "&sort=sim";
  }

  const apiUrl =
    `https://openapi.naver.com/v1/search/${path}.json` +
    `?query=${encodeURIComponent(query)}` +
    "&display=5" +
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

  if (!response.ok) {
    return [];
  }

  return (data.items || []).map((item) => ({
    source: `naver_${type}`,
    title: removeHtml(item.title),
    link: item.originallink || item.link || "",
    snippet: removeHtml(item.description),
    date: item.pubDate || item.postdate || null
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
    headers: {
      "User-Agent": "StellaGPT/1.0"
    }
  });

  const data = await safeJson(response);

  if (!response.ok) {
    return [];
  }

  const items = data.query?.search || [];

  return items.map((item) => {
    const title = item.title || "";
    const link =
      "https://ko.wikipedia.org/wiki/" +
      encodeURIComponent(title.replaceAll(" ", "_"));

    return {
      source: "wikipedia_ko",
      title: removeHtml(title),
      link,
      snippet: removeHtml(item.snippet),
      date: item.timestamp || null
    };
  });
}

async function searchNamuWiki(query) {
  if (
    !process.env.NAVER_CLIENT_ID ||
    !process.env.NAVER_CLIENT_SECRET
  ) {
    return [];
  }

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

  if (!response.ok) {
    return [];
  }

  return (data.items || [])
    .filter((item) => String(item.link || "").includes("namu.wiki"))
    .map((item) => ({
      source: "namu_wiki",
      title: removeHtml(item.title),
      link: item.link || "",
      snippet: removeHtml(item.description),
      date: null
    }));
}

async function searchGoogle(query) {
  if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CX) {
    return [];
  }

  const apiUrl =
    "https://www.googleapis.com/customsearch/v1" +
    `?key=${process.env.GOOGLE_API_KEY}` +
    `&cx=${process.env.GOOGLE_CX}` +
    `&q=${encodeURIComponent(query)}` +
    "&num=5";

  const response = await fetch(apiUrl, {
    method: "GET"
  });

  const data = await safeJson(response);

  if (!response.ok) {
    return [];
  }

  return (data.items || []).map((item) => ({
    source: "google_web",
    title: removeHtml(item.title),
    link: item.link || "",
    snippet: removeHtml(item.snippet),
    date: null
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
    const link = item?.link || "";

    if (!link) {
      return false;
    }

    if (seen.has(link)) {
      return false;
    }

    seen.add(link);
    return true;
  });
}
