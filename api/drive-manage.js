import { getDrive } from "../lib/drive-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false });
  const action = String(req.query.action || req.body?.action || "").trim();
  try {
    const drive = getDrive();

    // ── 폴더 생성 ──
    if (action === "mkdir") {
      const { parentId, name } = req.body || {};
      if (!parentId || !name) return res.status(400).json({ ok:false, message:"parentId, name 필요" });
      const f = await drive.files.create({
        requestBody: { name:String(name).trim(), mimeType:"application/vnd.google-apps.folder", parents:[parentId] },
        fields:"id,name,mimeType,createdTime"
      });
      return res.status(200).json({ ok:true, file:f.data });
    }

    // ── 삭제 (휴지통) ──
    if (action === "delete") {
      const { fileId } = req.body || {};
      if (!fileId) return res.status(400).json({ ok:false, message:"fileId 필요" });
      await drive.files.update({ fileId, requestBody:{ trashed:true } });
      return res.status(200).json({ ok:true, fileId });
    }

    // ── 다중 삭제 ──
    if (action === "deleteMany") {
      const { fileIds } = req.body || {};
      if (!Array.isArray(fileIds) || !fileIds.length) return res.status(400).json({ ok:false, message:"fileIds 필요" });
      const results = await Promise.allSettled(
        fileIds.map(id => drive.files.update({ fileId:id, requestBody:{ trashed:true } }))
      );
      const ok = results.filter(r=>r.status==="fulfilled").length;
      return res.status(200).json({ ok:true, deleted:ok, total:fileIds.length });
    }

    // ── 이름 변경 ──
    if (action === "rename") {
      const { fileId, newName } = req.body || {};
      if (!fileId || !newName) return res.status(400).json({ ok:false, message:"fileId, newName 필요" });
      const f = await drive.files.update({ fileId, requestBody:{ name:String(newName).trim() }, fields:"id,name" });
      return res.status(200).json({ ok:true, file:f.data });
    }

    // ── 이동 (부모 폴더 변경) ──
    if (action === "move") {
      const { fileId, newParentId, oldParentId } = req.body || {};
      if (!fileId || !newParentId) return res.status(400).json({ ok:false, message:"fileId, newParentId 필요" });
      const f = await drive.files.update({
        fileId,
        addParents: newParentId,
        removeParents: oldParentId || "",
        requestBody:{},
        fields:"id,name,parents"
      });
      return res.status(200).json({ ok:true, file:f.data });
    }

    // ── 파일 업로드 (base64) ──
    if (action === "upload") {
      const { parentId, fileName, mimeType, base64data } = req.body || {};
      if (!parentId || !fileName || !base64data) {
        return res.status(400).json({ ok:false, message:"parentId, fileName, base64data 필요" });
      }
      const buf = Buffer.from(base64data, "base64");
      const mt = mimeType || "application/octet-stream";

      // Vercel serverless: Buffer를 직접 media body로 전달
      const f = await drive.files.create({
        requestBody: { name: String(fileName), parents:[parentId], mimeType: mt },
        media: { mimeType: mt, body: buf },
        fields:"id,name,mimeType,size,webViewLink,createdTime"
      });
      return res.status(200).json({ ok:true, file:f.data });
    }

    return res.status(400).json({ ok:false, message:`알 수 없는 action: ${action}` });
  } catch(e) {
    return res.status(500).json({ ok:false, error:e.message, code:e.code||null, action });
  }
}
