function clean(value) {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  try {
    const location = clean(req.query?.location || req.body?.location || req.query?.q || req.body?.q || "Seoul");
    const key = clean(process.env.OPENWEATHER_API_KEY || process.env.WEATHER_API_KEY);
    if (!key) {
      return res.status(500).json({ ok: false, message: "날씨 API 키가 없습니다. Vercel 환경변수 OPENWEATHER_API_KEY 또는 WEATHER_API_KEY를 등록하세요." });
    }
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${encodeURIComponent(key)}&units=metric&lang=kr`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ ok: false, message: data.message || "날씨 조회 실패", raw: data });
    return res.status(200).json({
      ok: true,
      location,
      temperature: data.main?.temp,
      feels_like: data.main?.feels_like,
      humidity: data.main?.humidity,
      description: data.weather?.[0]?.description || "",
      wind: data.wind?.speed,
      raw: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "날씨 API 오류" });
  }
}
