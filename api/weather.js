// Google Weather API 직접 테스트 + 상세 진단
export default async function handler(req, res) {
  const location = String(req.query?.location || req.query?.q || req.body?.location || "송도").trim();
  const lat = req.query?.lat ? Number(req.query.lat) : null;
  const lng = req.query?.lng ? Number(req.query.lng) : null;

  const key = process.env.GOOGLE_WEATHER_API_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || process.env.GOOGLE_API_KEY;

  const diag = {
    keyConfigured: !!key,
    keyPrefix: key ? key.slice(0,8)+'...' : 'NONE',
    location,
    latLng: lat && lng ? {lat, lng} : null
  };

  if (!key) {
    return res.status(500).json({ ok: false, message: "API 키 없음 - Vercel에 GOOGLE_WEATHER_API_KEY 설정 필요", diag });
  }

  // 좌표 직접 제공 안 됐으면 Places API로 지오코딩
  let resolvedLat = lat, resolvedLng = lng, resolvedName = location;
  if (!resolvedLat || !resolvedLng) {
    try {
      const geoRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress"
        },
        body: JSON.stringify({ textQuery: location, languageCode: "ko" })
      });
      const geoData = await geoRes.json();
      if (!geoRes.ok) {
        return res.status(502).json({ ok: false, message: "Places API 오류", diag, geoError: geoData.error?.message || geoData });
      }
      const place = geoData.places?.[0];
      if (!place) {
        return res.status(404).json({ ok: false, message: `"${location}" 위치를 찾을 수 없습니다`, diag, geoData });
      }
      resolvedLat = place.location?.latitude;
      resolvedLng = place.location?.longitude;
      resolvedName = place.displayName?.text || location;
      diag.resolvedName = resolvedName;
      diag.resolvedLat = resolvedLat;
      diag.resolvedLng = resolvedLng;
    } catch(e) {
      return res.status(502).json({ ok: false, message: "Places API 호출 실패: " + e.message, diag });
    }
  }

  // Google Weather API 호출
  try {
    const url = new URL("https://weather.googleapis.com/v1/currentConditions:lookup");
    url.searchParams.set("key", key);
    url.searchParams.set("location.latitude", String(resolvedLat));
    url.searchParams.set("location.longitude", String(resolvedLng));
    url.searchParams.set("languageCode", "ko");

    const wRes = await fetch(url.toString());
    const wData = await wRes.json();

    if (!wRes.ok) {
      return res.status(wRes.status).json({
        ok: false,
        message: "Weather API 오류: " + (wData.error?.message || wData.error?.status || JSON.stringify(wData)),
        diag,
        rawError: wData.error
      });
    }

    // 성공 - 정제된 응답 반환
    const w = wData;
    const temp = w.temperature?.degrees ?? null;
    const feels = w.feelsLikeTemperature?.degrees ?? null;
    const humid = w.relativeHumidity ?? null;
    const windSpeed = w.wind?.speed?.value ?? null;
    const windDir = w.wind?.direction?.degrees ?? null;
    const desc = w.weatherCondition?.description?.text || w.weatherCondition?.type || "알 수 없음";
    const precip = w.precipitation?.probability?.percent ?? null;
    const uv = w.uvIndex ?? null;
    const vis = w.visibility?.distance ?? null;

    return res.status(200).json({
      ok: true,
      location: resolvedName,
      lat: resolvedLat,
      lng: resolvedLng,
      weather: {
        description: desc,
        temperature: temp,
        feelsLike: feels,
        humidity: humid,
        windSpeed,
        windDirection: windDir,
        precipitationChance: precip,
        uvIndex: uv,
        visibility: vis,
        currentTime: w.currentTime
      },
      diag,
      raw: w
    });
  } catch(e) {
    return res.status(500).json({ ok: false, message: "Weather API 호출 실패: " + e.message, diag });
  }
}
