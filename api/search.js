export default async function handler(req, res) {
  try {
    const query = req.query.q;
    const type = req.query.type || "web";
    const provider = req.query.provider || "naver";

    if (!query) {
      return res.status(400).json({
        error: "검색어가 없습니다."
      });
    }

    let results = [];

    if (provider === "naver") {
      results = await searchNaver(query, type);

      return res.status(200).json({
        query,
        provider: "naver",
        type,
        results
      });
    }

    if (provider === "google") {
      results = await searchGoogle(query);

      return res.status(200).json({
        query,
        provider: "google",
        type: "web",
        results
      });
    }

    if (provider === "wiki") {
      results = await searchWikipedia(query);

      return res.status(200).json({
        query,
        provider: "wiki",
        type: "encyclopedia",
        results
      });
    }

    if (provider === "namu") {
      results = await searchNamuWiki(query);

      return res.status(200).json({
        query,
        provider: "namu",
        type: "wiki",
        results
      });
    }

    if (provider === "knowledge") {
      const wikiResults = await searchWikipedia(query);
      const namuResults = await searchNamuWiki(query);

      results = removeDuplicateLinks([
        ...wikiResults,
        ...namuResults
      ]);

      return res.status(200).json({
        query,
        provider: "knowledge",
        type: "wiki",
        results
      });
    }

    if (provider === "all") {
      const naverResults = await searchNaver(query, type);
      const googleResults = await searchGoogle(query);
      const wikiResults = await searchWikipedia(query);
      const namuResults = await searchNamuWiki(query);

      results = removeDuplicateLinks([
        ...naverResults,
        ...googleResults,
        ...wikiResults,
        ...namuResults
      ]);

      return res.status(200).json({
        query,
        provider: "all",
        type,
        results
      });
    }

    return res.status(400).json({
      error: "지원하지 않는 provider입니다.",
      allowedProviders: [
        "naver",
        "google",
        "wiki",
        "namu",
        "knowledge",
        "all"
      ]
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}

/**
 * Naver Search API
 * type:
 * - web
 * - news
 * - blog
 */
async function searchNaver(query, type = "web") {
  let apiUrl = "";

  if (type === "news") {
    apiUrl =
      "https://openapi.naver.com/v1/search/news.json" +
      `?query=${encodeURIComponent(query)}` +
      "&display=5" +
      "&start=1" +
      "&sort=date";
  } else if (type === "blog") {
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
    throw new Error(
      "Naver Search API Error: " + JSON.stringify(data)
    );
  }

  return (data.items || []).map((item) => ({
    source: `naver_${type}`,
    title: removeHtml(item.title),
    link: item.originallink || item.link,
    snippet: removeHtml(item.description),
    date: item.pubDate || item.postdate || null
  }));
}

/**
 * Wikipedia Search
 * 한국어 위키백과 검색
 */
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
    const title = item.title;
    const link =
      "https://ko.wikipedia.org/wiki/" +
      encodeURIComponent(title.replaceAll(" ", "_"));

    return {
      source: "wikipedia_ko",
      title,
      link,
      snippet: removeHtml(item.snippet),
      date: item.timestamp || null
    };
  });
}

/**
 * Namu Wiki Search
 *
 * 나무위키는 여기서 직접 본문을 긁지 않고,
 * 네이버 웹검색 API로 site:namu.wiki 검색 결과만 가져온다.
 */
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
    .filter((item) => {
      const link = item.link || "";
      return link.includes("namu.wiki");
    })
    .map((item) => ({
      source: "namu_wiki",
      title: removeHtml(item.title),
      link: item.link,
      snippet: removeHtml(item.description),
      date: null
    }));
}

/**
 * Google Custom Search JSON API
 *
 * 필요한 Vercel 환경변수:
 * GOOGLE_API_KEY
 * GOOGLE_CX
 *
 * 아직 구글 API 키가 없으면 빈 배열 반환
 */
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
    title: item.title,
    link: item.link,
    snippet: item.snippet,
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
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function removeDuplicateLinks(results) {
  const seen = new Set();

  return results.filter((item) => {
    if (!item.link) return false;

    if (seen.has(item.link)) {
      return false;
    }

    seen.add(item.link);
    return true;
  });
}
