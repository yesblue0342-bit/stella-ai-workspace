// lib/chat/weather.mjs — 날씨 직접 응답(Open-Meteo, 무료). api/chat.js 분리의 일부.
//
// 비용 절감: 지오코딩(Google Places, 유료)과 예보(Open-Meteo) 응답을 프로세스 내 TTL 캐시로
// 재사용한다. 같은 도시를 반복 물어도 외부 호출이 다시 나가지 않는다.

const KR_CITIES = {
  "송도":{lat:37.3823,lng:126.6569},"인천":{lat:37.4563,lng:126.7052},
  "서울":{lat:37.5665,lng:126.9780},"강남":{lat:37.5172,lng:127.0473},
  "성남":{lat:37.4200,lng:127.1265},"판교":{lat:37.3947,lng:127.1112},
  "수원":{lat:37.2636,lng:127.0286},"부산":{lat:35.1796,lng:129.0756},
  "대전":{lat:36.3504,lng:127.3845},"대구":{lat:35.8714,lng:128.6014},
  "광주":{lat:35.1595,lng:126.8526},"울산":{lat:35.5384,lng:129.3114},
  "제주":{lat:33.4890,lng:126.4983},"익산":{lat:35.9483,lng:126.9576},
  "전주":{lat:35.8242,lng:127.1480},"청주":{lat:36.6424,lng:127.4890},
  "천안":{lat:36.8151,lng:127.1139},"포항":{lat:36.0190,lng:129.3435},
  "창원":{lat:35.2280,lng:128.6811},"고양":{lat:37.6584,lng:126.8320},
  "용인":{lat:37.2411,lng:127.1776},"평택":{lat:36.9921,lng:127.1128},
  "분당":{lat:37.3595,lng:127.1051},"일산":{lat:37.6761,lng:126.7769},
  "의정부":{lat:37.7382,lng:127.0337},"연수구":{lat:37.4108,lng:126.6780},
};

// WMO weather code → 한국어. 이전에는 같은 표가 두 벌(wmoToKr / handleWeather 내부) 있었고
// 실제로는 내부 사본만 쓰였다 → 런타임에서 쓰이던 사본으로 단일화하고 누락 코드(77/99)를 채웠다.
const WMO_KR = {
  0:"맑음",1:"대체로 맑음",2:"부분적으로 흐림",3:"흐림",
  45:"안개",48:"서리 안개",
  51:"가벼운 이슬비",53:"이슬비",55:"강한 이슬비",
  61:"약한 비",63:"비",65:"강한 비",
  71:"약한 눈",73:"눈",75:"강한 눈",77:"싸라기눈",
  80:"약한 소나기",81:"소나기",82:"강한 소나기",
  95:"천둥번개",96:"천둥번개+우박",99:"폭우 뇌우",
};

/** WMO 코드를 한국어 날씨 설명으로 변환. 미지 코드는 "정보 없음". */
export function wmoToKr(code) {
  return WMO_KR[code] || "정보 없음";
}

/**
 * 날씨 지표를 자연어 한 줄 요약(인용문)으로 만든다.
 * @param {{temp: number|string, feels: number|string, desc: string, precip: number|string, wind: number|string, uv: number|string, humid: number|string}} w
 * @returns {string}
 */
export function buildWeatherSummary(w) {
  const parts = [];
  const t = Number(w.temp);
  let tempPhrase;
  if (t >= 30) tempPhrase = "매우 더운 날씨";
  else if (t >= 25) tempPhrase = "더운 편";
  else if (t >= 20) tempPhrase = "따뜻한 날씨";
  else if (t >= 15) tempPhrase = "선선한 날씨";
  else if (t >= 10) tempPhrase = "쌀쌀한 날씨";
  else if (t >= 5) tempPhrase = "추운 편";
  else if (t >= 0) tempPhrase = "추운 날씨";
  else tempPhrase = "매우 추운 날씨";

  const feelGap = Math.abs(Number(w.feels) - t);
  const feelNote = feelGap >= 3 ? `(체감은 ${Number(w.feels) > t ? "더 높음" : "더 낮음"})` : "";
  parts.push(`현재 ${w.desc} 상태로 ${tempPhrase}입니다${feelNote ? " " + feelNote : ""}.`);

  if (Number(w.precip) >= 50) parts.push("☔ **우산을 꼭 챙기세요.**");
  else if (Number(w.precip) >= 30) parts.push("☔ 우산을 챙기는 것을 권장합니다.");

  if (Number(w.wind) >= 10) parts.push("🌬 바람이 강하니 주의하세요.");

  if (Number(w.uv) >= 8) parts.push("☀️ 자외선이 매우 강합니다. 선크림과 모자를 챙기세요.");
  else if (Number(w.uv) >= 6) parts.push("☀️ 자외선이 강한 편입니다.");

  if (Number(w.humid) >= 80) parts.push("💧 습도가 높아 무더울 수 있습니다.");
  else if (Number(w.humid) <= 30) parts.push("🏜 공기가 건조하니 수분 섭취에 유의하세요.");

  return `> ${parts.join(" ")}`;
}

// ───────── TTL 캐시 (프로세스 내, 반복 외부 호출 제거) ─────────
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;  // 좌표는 사실상 불변
const FORECAST_TTL_MS = 10 * 60 * 1000;      // 현재 날씨는 10분이면 충분히 신선
const geocodeCache = new Map();  // locationName -> { value, expires }
const forecastCache = new Map(); // "lat,lng"   -> { value, expires }

function cacheGet(store, key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { store.delete(key); return null; }
  return hit.value;
}
function cacheSet(store, key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

/** 테스트/운영 진단용 — 캐시를 비운다. */
export function clearWeatherCaches() {
  geocodeCache.clear();
  forecastCache.clear();
}

// 내장 좌표표 → Google Places 지오코딩 순으로 위치를 해석한다. 실패 시 null.
async function resolveLocation(locationName) {
  for (const [city, coord] of Object.entries(KR_CITIES)) {
    if (locationName.includes(city) || city.includes(locationName)) {
      return { lat: coord.lat, lng: coord.lng, resolvedName: city };
    }
  }

  const cached = cacheGet(geocodeCache, locationName);
  if (cached !== null) return cached;

  const key = process.env.GOOGLE_WEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const geoRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.location",
      },
      body: JSON.stringify({ textQuery: locationName, languageCode: "ko" }),
    });
    const geoData = await geoRes.json();
    const place = geoData.places?.[0];
    if (!place?.location) return null;
    const resolved = {
      lat: place.location.latitude,
      lng: place.location.longitude,
      resolvedName: place.displayName?.text || locationName,
    };
    cacheSet(geocodeCache, locationName, resolved, GEOCODE_TTL_MS);
    return resolved;
  } catch {
    return null;
  }
}

async function fetchForecast(lat, lng) {
  const key = `${lat},${lng}`;
  const cached = cacheGet(forecastCache, key);
  if (cached) return cached;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max");
  url.searchParams.set("timezone", "Asia/Seoul");
  url.searchParams.set("forecast_days", "1");

  const r = await fetch(url.toString());
  if (!r.ok) throw new Error("status " + r.status);
  const data = await r.json();
  cacheSet(forecastCache, key, data, FORECAST_TTL_MS);
  return data;
}

function naverLink(name) {
  return `[네이버 날씨](https://search.naver.com/search.naver?query=${encodeURIComponent(name + " 날씨")})`;
}
function googleLink(name, suffix = " 날씨") {
  return `[Google 날씨](https://www.google.com/search?q=${encodeURIComponent(name + suffix)})`;
}

/**
 * 날씨 질문에 마크다운 표 + 요약으로 직접 답한다(모델 호출 없음 → 토큰 0).
 * @param {string} message
 * @returns {Promise<string>}
 */
export async function handleWeather(message) {
  const locMatch = String(message || "").match(/([가-힣]{2,10}(?:시|구|군|동|읍|면|도)?)/);
  const locationName = locMatch ? locMatch[1] : "송도";
  const isDomestic = /[가-힣]/.test(locationName);

  const loc = await resolveLocation(locationName);
  if (!loc) {
    return `**${locationName}** 위치를 찾을 수 없습니다.\n\n${naverLink(locationName)} | ${googleLink(locationName)}`;
  }
  const { lat, lng, resolvedName } = loc;

  try {
    const w = await fetchForecast(lat, lng);
    const cur = w.current || {};
    const daily = w.daily || {};

    const desc = wmoToKr(cur.weather_code);
    const isDay = cur.is_day === 1;

    const temp = cur.temperature_2m?.toFixed(1) ?? "-";
    const feels = cur.apparent_temperature?.toFixed(1) ?? "-";
    const humid = cur.relative_humidity_2m ?? "-";
    const windSpeed = cur.wind_speed_10m?.toFixed(1) ?? "-";
    const tempMax = daily.temperature_2m_max?.[0]?.toFixed(1) ?? "-";
    const tempMin = daily.temperature_2m_min?.[0]?.toFixed(1) ?? "-";
    const precip = daily.precipitation_probability_max?.[0] ?? 0;
    const uv = daily.uv_index_max?.[0]?.toFixed(1) ?? "-";

    const umbrella = precip >= 60 ? "🌂 우산 필수" : precip >= 30 ? "☔ 우산 챙기면 좋음" : "☀️ 우산 불필요";
    const uvDesc = Number(uv) >= 8 ? "매우 높음" : Number(uv) >= 6 ? "높음" : Number(uv) >= 3 ? "보통" : "낮음";
    const humidDesc = Number(humid) > 70 ? "높음" : Number(humid) < 40 ? "건조" : "보통";
    const windDesc = Number(windSpeed) > 10 ? "강풍 주의" : Number(windSpeed) > 5 ? "바람 있음" : "약함";

    const mapLink = isDomestic ? naverLink(resolvedName) : googleLink(resolvedName, " weather");

    return [
      `**${resolvedName} 현재 날씨** — ${isDay ? "☀️" : "🌙"} ${desc}`,
      ``,
      buildWeatherSummary({ resolvedName, desc, temp, feels, humid, wind: windSpeed, precip, uv, umbrella, windDesc, uvDesc, humidDesc }),
      ``,
      `| 항목 | 값 | 비고 |`,
      `|---|---|---|`,
      `| 🌡 기온 | ${temp}°C | 체감 ${feels}°C |`,
      `| 📊 최고/최저 | ${tempMax}°C / ${tempMin}°C | 오늘 |`,
      `| 💧 습도 | ${humid}% | ${humidDesc} |`,
      `| 🌬 바람 | ${windSpeed}m/s | ${windDesc} |`,
      `| 🌧 강수확률 | ${precip}% | ${umbrella} |`,
      `| ☀️ UV 지수 | ${uv} | ${uvDesc} |`,
      ``,
      `${mapLink}`,
    ].join("\n");
  } catch (e) {
    console.warn("[weather] Open-Meteo 실패:", e.message);
    return `**${resolvedName} 날씨** API 일시 오류\n\n${naverLink(resolvedName)}`;
  }
}
