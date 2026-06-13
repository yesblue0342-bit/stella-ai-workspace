import { listJsonFromDrive } from "./drive-utils.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const pageSize = Number(req.query?.limit || req.body?.limit || 50);
    const files = await listJsonFromDrive({
      folderPath: ["MemberChat"],
      pageSize: Number.isFinite(pageSize) ? pageSize : 50
    });

    return res.status(200).json({
      ok: true,
      type: "member-chat-list",
      rooms: files.map((file) => ({
        id: file.id,
        name: file.name,
        link: file.webViewLink,
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "회원 채팅 목록 조회 실패", error: error.message });
  }
}
