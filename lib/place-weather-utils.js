function isDomesticCoord(lat,lng){return lat>=33&&lat<=39&&lng>=124&&lng<=132;}
export function detectSmartIntent(message = "") {
  const text = String(message || "").toLowerCase();
  if (["날씨", "기온", "우산", "weather", "forecast", "rain", "snow"].some((w) => text.includes(w))) return "weather";
  if (["맛집", "식당", "밥집", "카페", "장소", "근처", "주변", "restaurant", "cafe", "nearby", "map", "지도"].some((w) => text.includes(w))) return "place";
  return "general";
}

export async function getSmartContextForMessage(message = "") {
  const intent = detectSmartIntent(message);
  if (intent === "place") return await getPlaceContext(message);
  if (intent === "weather") return await getWeatherContext(message);
  return { used: false, intent: "general", provider: null, type: null, query: null, results: [], context: "", error: null };
}

function isDomestic(message = "") {
  const text = String(message || "").toLowerCase();
  const foreign = ["미국", "일본", "중국", "태국", "베트남", "유럽", "보스턴", "뉴욕", "도쿄", "오사카", "삿포로", "런던", "파리", "싱가포르", "상하이", "boston", "new york", "tokyo", "osaka", "sapporo", "london", "paris", "singapore", "shanghai"];
  if (foreign.some((w) => text.includes(w))) return false;
  const korea = ["한국", "국내", "서울", "인천", "송도", "연수구", "한라웨스턴파크", "부산", "대구", "대전", "광주", "제주", "성남", "수원", "판교", "용인", "익산", "전주", "청주", "천안"];
  if (korea.some((w) => text.includes(w))) return true;
  return /[가-힣]/.test(text);
}

function cleanQuery(message = "") {
  let text = String(message || "").trim();
  const remove = ["다시", "추천해줘", "추천", "알려줘", "찾아줘", "검색해줘", "검색", "정리해줘", "정리", "근처", "주변", "오늘", "내일", "현재", "지금", "날씨", "기온", "우산", "맛집", "식당", "밥집", "카페", "장소", "restaurant", "restaurants", "cafe", "nearby", "weather", "forecast"];
  for (const word of remove) text = text.replaceAll(word, " ");
  return text.replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim() || String(message || "").trim();
}

export async function getPlaceContext(message = "") {
  const domestic = isDomestic(message);
  const base = cleanQuery(message);
  const query = domestic ? `${base} 맛집`.trim() : `${base} restaurants`.trim();
  const primaryProvider = domestic ? "kakao_local" : "google_places";
  let results = [];
  let error = null;

  try { results = domestic ? await searchKakaoPlaces(query) : await searchGooglePlaces(query); }
  catch (err) { error = err.message || "place search error"; }

  if (results.length < 3) {
    try {
      const fallback = domestic ? await searchGooglePlaces(query) : await searchKakaoPlaces(query);
      results = dedupe([...results, ...fallback]);
    } catch {}
  }

  return { used: true, intent: domestic ? "domestic_place" : "overseas_place", provider: primaryProvider, type: "place", query, results: results.slice(0, 10), error, context: formatPlaces(results.slice(0, 10), domestic, error) };
}

export async function getWeatherContext(message = "") {
  const locationQuery = cleanQuery(message); let place = null; let weather = null; let error = null;
  try { place = await geocodeByGooglePlaces(locationQuery); if (!place?.lat || !place?.lng) throw new Error("위치 좌표를 찾지 못했습니다."); weather = await lookupGoogleWeather(place.lat, place.lng); }
  catch (err) { error = err.message || "weather search error"; }
  const results = weather ? [{ source: "google_weather", title: `${place?.name || locationQuery} 현재 날씨`, link: place?.mapUrl || "", snippet: summarizeWeather(weather), date: weather.currentTime || null }] : [];
  return { used: true, intent: "weather", provider: "google_weather", type: "weather", query: locationQuery, results, error, context: formatWeather(place, weather, error) };
}

async function searchKakaoPlaces(query) {
  const restApiKey = process.env.KAKAO_REST_API_KEY;
  if (!restApiKey) throw new Error("KAKAO_REST_API_KEY not configured");
  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", query); url.searchParams.set("size", "10"); url.searchParams.set("sort", "accuracy");
  const response = await fetch(url.toString(), { headers: { Authorization: "KakaoAK " + restApiKey } });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(data.message || data.error || "Kakao Local API Error");
  return (data.documents || []).map((item) => ({ source: "kakao_local", sourceLabel: "카카오맵", title: item.place_name || "", link: item.place_url || "", snippet: [item.category_name, item.road_address_name || item.address_name, item.phone ? `전화 ${item.phone}` : ""].filter(Boolean).join(" · "), address: item.road_address_name || item.address_name || "", lat: item.y ? Number(item.y) : null, lng: item.x ? Number(item.x) : null }));
}

async function searchGooglePlaces(query) {
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!mapsApiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured");
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": mapsApiKey, "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.googleMapsUri,places.location,places.primaryTypeDisplayName,places.businessStatus" }, body: JSON.stringify({ textQuery: query, languageCode: "ko" }) });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(data.error?.message || data.raw || "Google Places API Error");
  return (data.places || []).map((item) => ({ source: "google_places", sourceLabel: "구글맵", title: item.displayName?.text || "", link: item.googleMapsUri || "", snippet: [item.primaryTypeDisplayName?.text, item.formattedAddress, item.businessStatus].filter(Boolean).join(" · "), address: item.formattedAddress || "", lat: item.location?.latitude || null, lng: item.location?.longitude || null }));
}

async function geocodeByGooglePlaces(query) { const list = await searchGooglePlaces(query); const first = list[0]; if (!first) return null; return { name: first.title || query, address: first.address || "", lat: first.lat, lng: first.lng, mapUrl: first.link || "" }; }
async function lookupGoogleWeather(lat, lng) { const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY; if (!mapsApiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured"); const url = new URL("https://weather.googleapis.com/v1/currentConditions:lookup"); url.searchParams.set("key", mapsApiKey); url.searchParams.set("location.latitude", String(lat)); url.searchParams.set("location.longitude", String(lng)); url.searchParams.set("languageCode", "ko"); const response = await fetch(url.toString()); const data = await safeJson(response); if (!response.ok) throw new Error(data.error?.message || data.raw || "Google Weather API Error"); return data; }

function formatPlaces(results, domestic, error) {
  const title = domestic ? "국내 장소 검색 기준: 카카오맵 우선, 결과 부족 시 구글맵 보조" : "해외 장소 검색 기준: 구글맵 우선, 결과 부족 시 카카오 보조";
  if (error && results.length === 0) return `${title}\n장소 API 오류: ${error}`;
  if (!results.length) return `${title}\n장소 API 결과 없음.`;
  const rows = results.map((item, index) => `| ${index + 1} | ${item.title} | ${item.sourceLabel || item.source} | ${item.address || "없음"} | [지도 열기](${item.link || "#"}) | ${item.snippet || ""} |`);
  return [`${title}\n아래 URL은 반드시 클릭 가능한 Markdown 링크로 표시하세요.`, "", "| No | 이름 | 지도 | 주소 | 링크 | 요약 |", "|---:|---|---|---|---|---|", ...rows].join("\n");
}
function formatWeather(place, weather, error) { if (error) return `Google Weather API 오류: ${error}`; if (!weather) return "Google Weather API 결과 없음"; return [`위치: ${place?.name || "알 수 없음"}`, `주소: ${place?.address || "없음"}`, `지도: ${place?.lat ? (isDomesticCoord(place.lat, place.lng) ? `[카카오맵](https://map.kakao.com/link/search/${encodeURIComponent(place?.name || "")})` : `[Google Maps](${place?.mapUrl || "#"})`) : (place?.mapUrl ? `[지도 열기](${place.mapUrl})` : "없음")}`, `현재 날씨: ${weather.weatherCondition?.description?.text || weather.weatherCondition?.type || "없음"}`, `기온: ${formatDegrees(weather.temperature)}`, `체감: ${formatDegrees(weather.feelsLikeTemperature)}`, `습도: ${weather.relativeHumidity ?? "없음"}%`, `강수확률: ${weather.precipitation?.probability?.percent ?? "없음"}%`, `바람: ${weather.wind?.speed?.value ?? "없음"} ${weather.wind?.speed?.unit || ""}`, `UV: ${weather.uvIndex ?? "없음"}`, `기준시각: ${weather.currentTime || "없음"}`].join("\n"); }
function summarizeWeather(weather) { return `${weather.weatherCondition?.description?.text || "날씨 정보"}, 기온 ${formatDegrees(weather.temperature)}, 체감 ${formatDegrees(weather.feelsLikeTemperature)}, 강수확률 ${weather.precipitation?.probability?.percent ?? "없음"}%`; }
function formatDegrees(value) { if (!value || typeof value.degrees !== "number") return "없음"; return `${Math.round(value.degrees * 10) / 10}°${value.unit === "FAHRENHEIT" ? "F" : "C"}`; }
function dedupe(results) { const seen = new Set(); return (results || []).filter((item) => { const marker = item.link || `${item.source}:${item.title}:${item.address}`; if (!item?.title || seen.has(marker)) return false; seen.add(marker); return true; }); }
async function safeJson(response) { const raw = await response.text(); try { return JSON.parse(raw); } catch { return { raw }; } }

