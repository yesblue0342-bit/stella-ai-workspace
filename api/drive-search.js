import { searchDrive } from "./drive-utils.js";

function normalizeQuery(value = "") {
  return String(value || "")
    .replace(/#DB/gi, "")
    .replace(/#SAP/gi, "")
    .replace(/#StellaGPT/gi, "")
    .replace(/구글\s*드라이브|Drive|Knowledge|내\s*문서|자료\s*기준|폴더에서|검색해줘|찾아줘|검색|찾아/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const raw = req.query?.q || req.query?.query || req.body?.q || req.body?.query || req.body?.message || "";
    const query = normalizeQuery(raw) || String(raw || "").trim();
    const limit = Number(req.query?.limit || req.body?.limit || 20);

    if (!query) {
      return res.status(400).json({ ok: false, message: "검색어를 입력하세요." });
    }

    const files = await searchDrive({ query, pageSize: Number.isFinite(limit) ? limit : 20 });

    return res.status(200).json({
      ok: true,
      type: "drive-search",
      query,
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        link: file.webViewLink,
        modifiedTime: file.modifiedTime,
        size: file.size || null
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Google Drive 검색 실패", error: error.message });
  }
}
