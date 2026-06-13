import { getPlaceContext } from "./place-weather-utils.js";

export default async function handler(req, res) {
  try {
    const query = String(req.query?.q || req.query?.query || req.body?.q || req.body?.query || "").trim();
    if (!query) return res.status(400).json({ ok: false, message: "q is required" });

    const result = await getPlaceContext(query);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "장소 검색 실패", error: error.message });
  }
}
