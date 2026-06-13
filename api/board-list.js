import { listJsonFromDrive } from "./drive-utils.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const category = String(req.query?.category || req.body?.category || "Board").trim();
    const limit = Number(req.query?.limit || req.body?.limit || 50);
    const files = await listJsonFromDrive({
      folderPath: ["Board", category],
      pageSize: Number.isFinite(limit) ? limit : 50
    });

    return res.status(200).json({
      ok: true,
      type: "board-list",
      category,
      posts: files.map((file) => ({
        id: file.id,
        name: file.name,
        link: file.webViewLink,
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "게시글 목록 조회 실패", error: error.message });
  }
}
