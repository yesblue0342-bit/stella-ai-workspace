import { listJsonFromDrive } from "./drive-utils.js";

function clean(value = "") {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  try {
    const userId = clean(req.query?.userId || req.query?.email || req.body?.userId || req.body?.email || "guest");
    const limit = Math.min(Number(req.query?.limit || req.body?.limit || 50), 100);

    const files = await listJsonFromDrive({
      folderPath: ["ChatHistory", userId],
      pageSize: limit
    });

    return res.status(200).json({
      ok: true,
      message: "Stella GPT 채팅 목록 조회 완료",
      userId,
      count: files.length,
      files
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Stella GPT 채팅 목록 조회 실패", error: error.message });
  }
}
