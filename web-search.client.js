/**
 * Stella Workspace
 * Web Search Client
 *
 * 지원 검색 엔진
 * - Google Search
 * - Naver Search
 * - News Search
 * - Custom Search
 */

export async function searchGoogle(query) {

  const response = await fetch(
    `/api/search/google?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error("Google Search Error");
  }

  return await response.json();
}

export async function searchNaver(query) {

  const response = await fetch(
    `/api/search/naver?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error("Naver Search Error");
  }

  return await response.json();
}

export async function searchNews(query) {

  const response = await fetch(
    `/api/search/news?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error("News Search Error");
  }

  return await response.json();
}

export async function searchCustom(query) {

  const response = await fetch(
    `/api/search/custom?q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error("Custom Search Error");
  }

  return await response.json();
}

export async function searchWeb(
  provider,
  query
) {

  switch(provider){

    case "google":
      return await searchGoogle(query);

    case "naver":
      return await searchNaver(query);

    case "news":
      return await searchNews(query);

    case "custom":
      return await searchCustom(query);

    default:
      throw new Error(
        "지원하지 않는 검색 엔진"
      );
  }
}

export default {
  searchGoogle,
  searchNaver,
  searchNews,
  searchCustom,
  searchWeb
};
