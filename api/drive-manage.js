// OAuth2 access token 획득 (fetch 기반, Vercel 완전 호환)
async function getAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth 환경변수 미설정");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("access_token 획득 실패: " + JSON.stringify(d));
  return d.access_token;
}

// fetch 기반 멀티파트 업로드 (Vercel serverless 완전 호환)
async function uploadFileToDrive({ parentId, fileName, mimeType, base64data }) {
  const token = await getAccessToken();
  const buf = Buffer.from(base64data, "base64");
  const mt = mimeType || "application/octet-stream";

  const boundary = "stella_upload_" + Date.now();
  const metadata = JSON.stringify({ name: String(fileName), parents: [parentId], mimeType: mt });

  const metaPart = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    ""
  ].join("\r\n");

  const filePart = [
    `--${boundary}`,
    `Content-Type: ${mt}`,
    "",
    ""
  ].join("\r\n");

  const closing = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metaPart, "utf-8"),
    Buffer.from(filePart, "utf-8"),
    buf,
    Buffer.from(closing, "utf-8")
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length)
      },
      body
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

// googleapis 기반 drive 인스턴스 (upload 제외한 나머지 action에 사용)
function getDriveClient() {
  const { google } = require("googleapis");
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const action = String(req.query.action || req.body?.action || "").trim();

  // ── 파일 업로드: getDrive() 없이 독립 실행 ──
  if (action === "upload") {
    try {
      const { parentId, fileName, mimeType, base64data } = req.body || {};
      if (!parentId || !fileName || !base64data) {
        return res.status(400).json({ ok: false, message: "parentId, fileName, base64data 필요" });
      }
      const file = await uploadFileToDrive({ parentId, fileName, mimeType, base64data });
      return res.status(200).json({ ok: true, file });
    } catch (e) {
      console.error("[drive-manage/upload]", e.message);
      return res.status(500).json({ ok: false, error: e.message, action });
    }
  }

  // ── 나머지 action: drive 클라이언트 사용 ──
  try {
    const drive = getDriveClient();

    // ── 폴더 생성 ──
    if (action === "mkdir") {
      const { parentId, name } = req.body || {};
      if (!parentId || !name) return res.status(400).json({ ok: false, message: "parentId, name 필요" });
      const f = await drive.files.create({
        requestBody: { name: String(name).trim(), mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
        fields: "id,name,mimeType,createdTime"
      });
      return res.status(200).json({ ok: true, file: f.data });
    }

    // ── 삭제 ──
    if (action === "delete") {
      const { fileId } = req.body || {};
      if (!fileId) return res.status(400).json({ ok: false, message: "fileId 필요" });
      await drive.files.update({ fileId, requestBody: { trashed: true } });
      return res.status(200).json({ ok: true, fileId });
    }

    // ── 다중 삭제 ──
    if (action === "deleteMany") {
      const { fileIds } = req.body || {};
      if (!Array.isArray(fileIds) || !fileIds.length) return res.status(400).json({ ok: false, message: "fileIds 필요" });
      const results = await Promise.allSettled(
        fileIds.map(id => drive.files.update({ fileId: id, requestBody: { trashed: true } }))
      );
      const ok = results.filter(r => r.status === "fulfilled").length;
      return res.status(200).json({ ok: true, deleted: ok, total: fileIds.length });
    }

    // ── 이름 변경 ──
    if (action === "rename") {
      const { fileId, newName } = req.body || {};
      if (!fileId || !newName) return res.status(400).json({ ok: false, message: "fileId, newName 필요" });
      const f = await drive.files.update({ fileId, requestBody: { name: String(newName).trim() }, fields: "id,name" });
      return res.status(200).json({ ok: true, file: f.data });
    }

    // ── 이동 ──
    if (action === "move") {
      const { fileId, newParentId, oldParentId } = req.body || {};
      if (!fileId || !newParentId) return res.status(400).json({ ok: false, message: "fileId, newParentId 필요" });
      const f = await drive.files.update({
        fileId, addParents: newParentId, removeParents: oldParentId || "",
        requestBody: {}, fields: "id,name,parents"
      });
      return res.status(200).json({ ok: true, file: f.data });
    }

    return res.status(400).json({ ok: false, message: `알 수 없는 action: ${action}` });

  } catch (e) {
    console.error("[drive-manage]", e.message);
    return res.status(500).json({ ok: false, error: e.message, action });
  }
}
