// POST /api/memory/extract — 발화에서 기억 후보 생성(OpenAI). 저장 X. graceful.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST only" });
  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ ok:false, error:"text required" });
    if (!process.env.OPENAI_API_KEY) return res.status(200).json({ ok:true, candidates:[] });

    const sys = [
      "너는 사용자 발화에서 장기 기억으로 저장할 가치가 있는 사실/선호를 추출한다.",
      '반드시 {"candidates":[...]} 형태의 JSON 으로만 반환한다.',
      '각 원소: {"memory_text": string, "category": "fact|preference|project|identity", "save": true|false}.',
      "저장 가치가 없으면 candidates 는 빈 배열. 한국어 원문 의미를 보존하되 간결한 1인칭 서술로 정규화한다.",
    ].join("\n");

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MEMORY_MODEL || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role:"system", content: sys }, { role:"user", content: String(text) }],
      }),
    });
    const data = await r.json();
    let candidates = [];
    try {
      const parsed = JSON.parse(data.choices[0].message.content);
      candidates = (parsed.candidates || []).filter(c => c && c.save && c.memory_text);
    } catch { /* ignore */ }
    return res.status(200).json({ ok:true, candidates });
  } catch (e) {
    return res.status(200).json({ ok:true, candidates:[], warn:String(e && e.message || e) });
  }
}
