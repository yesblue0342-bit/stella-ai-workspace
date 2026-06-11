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

    if (provider === "all") {
      const naverResults = await searchNaver(query, type);
      const googleResults = await searchGoogle(query);

      results = removeDuplicateLinks([
        ...naverResults,
        ...googleResults
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
      allowedProviders: ["naver", "google", "all"]
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

  const data = await response.json();

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
 * Google Custom Search JSON API
 *
 * 필요한 Vercel 환경변수:
 * GOOGLE_API_KEY
 * GOOGLE_CX
 *
 * 아직 구글 API 키가 없으면 이 함수는 빈 배열을 반환함.
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      "Google Search API Error: " + JSON.stringify(data)
    );
  }

  return (data.items || []).map((item) => ({
    source: "google_web",
    title: item.title,
    link: item.link,
    snippet: item.snippet,
    date: null
  }));
}

function removeHtml(text = "") {
  return text.replace(/<[^>]*>/g, "");
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
