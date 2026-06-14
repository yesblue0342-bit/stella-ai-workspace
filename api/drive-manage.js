// Drive 파일 관리 API: 업로드, 삭제, 폴더 생성, 폴더 삭제
import { getDrive } from "../lib/drive-utils.js";

function drv(){ return getDrive(); }

export default async function handler(req, res) {
  const action = String(req.query.action || req.body?.action || "").trim();
  try {
    const drive = drv();

    // ── 폴더 생성 ──
    if (action === "mkdir") {
      const parentId = String(req.body?.parentId || "");
      const name = String(req.body?.name || "").trim();
      if (!parentId || !name) return res.status(400).json({ ok:false, message:"parentId, name 필요" });
      const f = await drive.files.create({
        requestBody: { name, mimeType:"application/vnd.google-apps.folder", parents:[parentId] },
        fields:"id,name,mimeType,createdTime"
      });
      return res.status(200).json({ ok:true, file:f.data });
    }

    // ── 파일/폴더 삭제 (휴지통으로) ──
    if (action === "delete") {
      const fileId = String(req.body?.fileId || "").trim();
      if (!fileId) return res.status(400).json({ ok:false, message:"fileId 필요" });
      await drive.files.update({ fileId, requestBody:{ trashed:true } });
      return res.status(200).json({ ok:true, message:"삭제(휴지통) 완료", fileId });
    }

    // ── 파일 업로드 (base64) ──
    if (action === "upload") {
      const { parentId, fileName, mimeType, base64data } = req.body || {};
      if (!parentId || !fileName || !base64data) return res.status(400).json({ ok:false, message:"parentId, fileName, base64data 필요" });
      const buf = Buffer.from(base64data, "base64");
      const { Readable } = await import("stream");
      const stream = Readable.from(buf);
      const f = await drive.files.create({
        requestBody: { name: fileName, parents:[parentId], mimeType: mimeType || "application/octet-stream" },
        media: { mimeType: mimeType || "application/octet-stream", body: stream },
        fields:"id,name,mimeType,size,webViewLink,createdTime"
      });
      return res.status(200).json({ ok:true, file:f.data });
    }

    // ── 이름 변경 ──
    if (action === "rename") {
      const { fileId, newName } = req.body || {};
      if (!fileId || !newName) return res.status(400).json({ ok:false, message:"fileId, newName 필요" });
      const f = await drive.files.update({ fileId, requestBody:{ name: newName }, fields:"id,name" });
      return res.status(200).json({ ok:true, file:f.data });
    }

    return res.status(400).json({ ok:false, message:`알 수 없는 action: ${action}` });
  } catch(e) {
    return res.status(500).json({ ok:false, error:e.message, action });
  }
}
