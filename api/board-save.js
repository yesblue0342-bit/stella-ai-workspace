import { saveJsonToDrive } from "./drive-utils.js";

function clean(value) {
  return String(value || "").trim();
}

function makePostId(value) {
  const raw = clean(value) || `post_${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 90);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const title = clean(body.title);
    const content = clean(body.content || body.body || body.text);
    const writer = clean(body.writer || body.userName || body.name || "unknown");
    const userId = clean(body.userId || body.email || writer || "unknown");
    const category = clean(body.category || "Board");
    const postId = makePostId(body.postId || body.id || title);

    if (!title && !content) {
      return res.status(400).json({ ok: false, message: "제목 또는 내용을 입력하세요." });
    }

    const data = {
      type: "boardPost",
      postId,
      title: title || "제목 없음",
      content,
      writer,
      userId,
      category,
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = await saveJsonToDrive({
      folderPath: ["Board", category],
      fileName: `${postId}.json`,
      data
    });

    return res.status(200).json({ ok: true, message: "게시글 저장 완료", saved, post: data });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "게시글 저장 실패", error: error.message });
  }
}
