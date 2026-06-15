// 한국 주요 도시 좌표 (Places API 없어도 즉시 사용)
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
  "화성":{lat:37.1993,lng:126.8316},"안산":{lat:37.3219,lng:126.8308},
  "분당":{lat:37.3595,lng:127.1051},"일산":{lat:37.6761,lng:126.7769},
  "의정부":{lat:37.7382,lng:127.0337},"연수구":{lat:37.4108,lng:126.6780},
};

// WMO 날씨 코드 → 한국어
function wmoToKr(code) {
  const map = {
    0:"맑음",1:"대체로 맑음",2:"부분적으로 흐림",3:"흐림",
    45:"안개",48:"안개(서리)",
    51:"가벼운 이슬비",53:"이슬비",55:"짙은 이슬비",
    61:"가벼운 비",63:"비",65:"폭우",
    71:"가벼운 눈",73:"눈",75:"폭설",77:"싸라기눈",
    80:"소나기(약)",81:"소나기",82:"폭우 소나기",
    85:"눈 소나기",86:"폭설 소나기",
    95:"뇌우",96:"우박 뇌우",99:"폭우 뇌우"
  };
  return map[code] || "날씨 정보 없음";
}

export default async function handler(req, res) {
  const location = String(req.query?.location || req.query?.q || req.body?.location || "송도").trim();

  // 1) 좌표 확보
  let lat = null, lng = null, resolvedName = location;

  // 한국 도시 테이블 우선
  for (const [city, coord] of Object.entries(KR_CITIES)) {
    if (location.includes(city) || city.includes(location)) {
      lat = coord.lat; lng = coord.lng;
      resolvedName = city;
      break;
    }
  }

  // Google Places로 지오코딩 (키 있을 때)
  if (!lat || !lng) {
    const gKey = process.env.GOOGLE_WEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
    if (gKey) {
      try {
        const gRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method:"POST",
          headers:{"Content-Type":"application/json","X-Goog-Api-Key":gKey,"X-Goog-FieldMask":"places.displayName,places.location"},
          body:JSON.stringify({textQuery:location,languageCode:"ko"})
        });
        const gData = await gRes.json();
        const place = gData.places?.[0];
        if (place?.location) {
          lat = place.location.latitude;
          lng = place.location.longitude;
          resolvedName = place.displayName?.text || location;
        }
      } catch {}
    }
  }

  if (!lat || !lng) {
    return res.status(404).json({ ok:false, message:`"${location}" 위치를 찾을 수 없습니다. 도시명을 다시 확인하세요.` });
  }

  // 2) Open-Meteo API (무료, 키 불필요, 한국 완벽 지원)
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", [
      "temperature_2m","apparent_temperature","relative_humidity_2m",
      "precipitation_probability","weather_code","wind_speed_10m",
      "wind_direction_10m","uv_index","visibility","surface_pressure"
    ].join(","));
    url.searchParams.set("timezone", "Asia/Seoul");
    url.searchParams.set("wind_speed_unit", "ms");

    const r = await fetch(url.toString());
    const data = await r.json();

    if (!r.ok || !data.current) {
      return res.status(502).json({ ok:false, message:"날씨 데이터 수신 실패", raw:data });
    }

    const c = data.current;
    const desc = wmoToKr(c.weather_code);
    const temp = c.temperature_2m;
    const feels = c.apparent_temperature;
    const humid = c.relative_humidity_2m;
    const windSpeed = c.wind_speed_10m;
    const precip = c.precipitation_probability;
    const uv = c.uv_index;
    const vis = c.visibility ? (c.visibility / 1000).toFixed(1) + "km" : "-";
    const pressure = c.surface_pressure ? c.surface_pressure.toFixed(0) + "hPa" : "-";

    return res.status(200).json({
      ok: true,
      location: resolvedName,
      lat, lng,
      provider: "open-meteo",
      weather: {
        description: desc,
        temperature: temp,
        feelsLike: feels,
        humidity: humid,
        windSpeed,
        precipitationChance: precip,
        uvIndex: uv,
        visibility: vis,
        pressure,
        currentTime: c.time
      }
    });
  } catch(e) {
    return res.status(500).json({ ok:false, message:"날씨 API 오류: " + e.message });
  }
}
