function clean(value) {
  return String(value || "").trim();
}

function isKorea(value) {
  const text = clean(value).toLowerCase();
  return /(^kr$|korea|대한민국|한국|서울|부산|인천|대구|대전|광주|울산|세종|경기|강원|충청|전라|경상|제주)/i.test(text);
}

export default async function handler(req, res) {
  const q = clean(req.query?.q || req.body?.q || req.query?.address || req.body?.address);
  const country = clean(req.query?.country || req.body?.country || q);
  const provider = isKorea(country) ? "kakao" : "google";

  return res.status(200).json({
    ok: true,
    provider,
    rule: "국내는 카카오맵 우선, 해외는 구글맵 우선",
    query: q,
    country,
    kakaoReady: Boolean(process.env.KAKAO_REST_API_KEY || process.env.KAKAO_MAP_KEY),
    googleReady: Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY)
  });
}
