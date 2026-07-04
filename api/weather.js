// Open-Meteo API (무료, 키 불필요, 전 세계 지원)
// 한국 도시 좌표 테이블 + Google Places 폴백 지오코딩
const KR_CITIES = {
  "송도": {lat:37.3823, lng:126.6569}, "송도동": {lat:37.3823, lng:126.6569},
  "인천": {lat:37.4563, lng:126.7052}, "연수구": {lat:37.4101, lng:126.6788},
  "서울": {lat:37.5665, lng:126.9780}, "강남": {lat:37.4979, lng:127.0276},
  "강북": {lat:37.6396, lng:127.0257}, "성남": {lat:37.4200, lng:127.1265},
  "판교": {lat:37.3947, lng:127.1112}, "수원": {lat:37.2636, lng:127.0286},
  "용인": {lat:37.2411, lng:127.1776}, "안양": {lat:37.3943, lng:126.9568},
  "부산": {lat:35.1796, lng:129.0756}, "대전": {lat:36.3504, lng:127.3845},
  "대구": {lat:35.8714, lng:128.6014}, "광주": {lat:35.1595, lng:126.8526},
  "울산": {lat:35.5384, lng:129.3114}, "세종": {lat:36.4800, lng:127.2890},
  "제주": {lat:33.4890, lng:126.4983}, "익산": {lat:35.9483, lng:126.9576},
  "전주": {lat:35.8242, lng:127.1480}, "청주": {lat:36.6424, lng:127.4890},
  "천안": {lat:36.8151, lng:127.1139}, "포항": {lat:36.0190, lng:129.3435},
  "춘천": {lat:37.8813, lng:127.7298}, "강릉": {lat:37.7519, lng:128.8761},
  "여수": {lat:34.7604, lng:127.6622}, "목포": {lat:34.8118, lng:126.3922},
};

// WMO 날씨 코드 → 한국어
function wmoToKr(code) {
  const map = {
    0:"맑음", 1:"대체로 맑음", 2:"부분적으로 흐림", 3:"흐림",
    45:"안개", 48:"서리 안개",
    51:"가벼운 이슬비", 53:"이슬비", 55:"강한 이슬비",
    56:"얼어붙는 이슬비", 57:"강한 얼어붙는 이슬비",
    61:"약한 비", 63:"비", 65:"강한 비",
    66:"얼어붙는 비", 67:"강한 얼어붙는 비",
    71:"약한 눈", 73:"눈", 75:"강한 눈",
    77:"눈알갱이", 80:"약한 소나기", 81:"소나기", 82:"강한 소나기",
    85:"약한 눈 소나기", 86:"강한 눈 소나기",
    95:"천둥번개", 96:"천둥번개+우박", 99:"강한 천둥번개+우박"
  };
  return map[code] || "정보 없음";
}

export default async function handler(req, res) {
  const location = String(req.query?.location || req.query?.q || req.body?.location || "송도").trim();
  let lat = req.query?.lat ? Number(req.query.lat) : null;
  let lng = req.query?.lng ? Number(req.query.lng) : null;
  let resolvedName = location;

  // 1) 한국 도시 테이블 우선
  if (!lat || !lng) {
    for (const [city, coord] of Object.entries(KR_CITIES)) {
      if (location.includes(city) || city.includes(location)) {
        lat = coord.lat;
        lng = coord.lng;
        resolvedName = city;
        break;
      }
    }
  }

  // 2) Google Places 지오코딩 폴백
  if (!lat || !lng) {
    const key = process.env.GOOGLE_WEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      try {
        const geoRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.displayName,places.location"
          },
          body: JSON.stringify({ textQuery: location, languageCode: "ko" })
        });
        const geoData = await geoRes.json();
        const place = geoData.places?.[0];
        if (place?.location) {
          lat = place.location.latitude;
          lng = place.location.longitude;
          resolvedName = place.displayName?.text || location;
        }
      } catch { /* ignore */ }
    }
  }

  if (!lat || !lng) {
    return res.status(404).json({
      ok: false,
      message: `"${location}" 위치를 찾을 수 없습니다.`,
      hint: "한국 주요 도시 또는 Google Places로 검색 가능한 곳을 입력하세요."
    });
  }

  // 3) Open-Meteo API 호출 (무료, 키 불필요)
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max");
    url.searchParams.set("timezone", "Asia/Seoul");
    url.searchParams.set("forecast_days", "1");

    const wRes = await fetch(url.toString());
    if (!wRes.ok) {
      return res.status(wRes.status).json({ ok: false, message: "Open-Meteo API 오류: " + wRes.status });
    }
    const w = await wRes.json();
    const cur = w.current || {};
    const daily = w.daily || {};

    return res.status(200).json({
      ok: true,
      location: resolvedName,
      lat, lng,
      weather: {
        description: wmoToKr(cur.weather_code),
        weatherCode: cur.weather_code,
        temperature: cur.temperature_2m,
        feelsLike: cur.apparent_temperature,
        humidity: cur.relative_humidity_2m,
        windSpeed: cur.wind_speed_10m,
        windDirection: cur.wind_direction_10m,
        precipitation: cur.precipitation,
        isDay: cur.is_day === 1,
        tempMax: daily.temperature_2m_max?.[0],
        tempMin: daily.temperature_2m_min?.[0],
        precipitationChance: daily.precipitation_probability_max?.[0],
        uvIndex: daily.uv_index_max?.[0],
        currentTime: cur.time
      },
      source: "open-meteo"
    });
  } catch(e) {
    return res.status(500).json({ ok: false, message: "Open-Meteo 호출 실패: " + e.message });
  }
}
