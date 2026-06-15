// api/drive-upload.js
// 이미지/파일을 서버에서 Drive에 업로드하고 공개 URL 반환
// base64 또는 multipart/form-data 지원

import { getDrive, getDriveRootId, FOLDER_MIME } from "../lib/drive-utils.js";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
  maxDuration: 30
};

// MemberChat/images 폴더 확보
async function ensureImagesFolder(drive, rootId) {
  const esc = (v) => String(v || "").replace(/'/g, "\\'");

  // MemberChat 폴더
  let chatId = rootId;
  const r1 = await drive.files.list({
    q: `mimeType='${FOLDER_MIME}' and name='MemberChat' and '${esc(rootId)}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1
  });
  if (r1.data.files?.[0]) {
    chatId = r1.data.files[0].id;
  } else {
    const c1 = await drive.files.create({
      requestBody: { name: "MemberChat", mimeType: FOLDER_MIME, parents: [rootId] },
      fields: "id"
    });
    chatId = c1.data.id;
  }

  // MemberChat/images 폴더
  const r2 = await drive.files.list({
    q: `mimeType='${FOLDER_MIME}' and name='images' and '${esc(chatId)}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1
  });
  if (r2.data.files?.[0]) return r2.data.files[0].id;

  const c2 = await drive.files.create({
    requestBody: { name: "images", mimeType: FOLDER_MIME, parents: [chatId] },
    fields: "id"
  });
  return c2.data.id;
}

// Drive 파일을 공개 공유 설정
async function makePublic(drive, fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" }
    });
  } catch (e) {
    // 공개 설정 실패해도 계속 진행
    console.warn("[drive-upload] 공개 설정 실패:", e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method Not Allowed" });

  try {
    const body = req.body || {};
    const base64Data = String(body.base64 || "");      // "data:image/jpeg;base64,/9j/..."
    const fileName = String(body.fileName || `img_${Date.now()}.jpg`);
    const mimeType = String(body.mimeType || "image/jpeg");

    if (!base64Data) return res.status(400).json({ ok: false, message: "base64 데이터가 없습니다." });

    // base64 디코딩
    const base64Body = base64Data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Body, "base64");
    if (!buffer.length) return res.status(400).json({ ok: false, message: "이미지 데이터 변환 실패" });

    const drive = getDrive();
    const rootId = getDriveRootId();
    const folderId = await ensureImagesFolder(drive, rootId);

    // Drive에 업로드
    const { Readable } = await import("stream");
    const stream = Readable.from(buffer);

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        parents: [folderId]
      },
      media: { mimeType, body: stream },
      fields: "id,name,webViewLink,webContentLink"
    });

    const fileId = uploaded.data.id;
    if (!fileId) return res.status(500).json({ ok: false, message: "Drive 업로드 실패" });

    // 공개 공유 설정
    await makePublic(drive, fileId);

    // 직접 표시 가능한 URL (thumbnail API 방식이 가장 안정적)
    const imageUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
    // fallback URL
    const fallbackUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return res.status(200).json({
      ok: true,
      fileId,
      imageUrl,
      fallbackUrl,
      webViewLink: uploaded.data.webViewLink || "",
      fileName
    });
  } catch (error) {
    console.error("[drive-upload] 오류:", error.message);
    return res.status(500).json({ ok: false, message: error.message || "업로드 실패" });
  }
}
