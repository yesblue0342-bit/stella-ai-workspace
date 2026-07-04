import { getDrive, getDriveRootIdSafe, FOLDER_MIME } from "../lib/drive-utils.js";

// MemberChat/images 폴더 ID를 찾거나 생성
async function ensureMediaFolder() {
  const drive = getDrive();
  const rootId = await getDriveRootIdSafe();

  // MemberChat 폴더 찾기
  let chatFolderId;
  const chatQ = `mimeType='${FOLDER_MIME}' and name='MemberChat' and '${rootId}' in parents and trashed=false`;
  const chatRes = await drive.files.list({ q: chatQ, fields: "files(id,name)", pageSize: 1 });
  if (chatRes.data.files?.[0]) {
    chatFolderId = chatRes.data.files[0].id;
  } else {
    // MemberChat 폴더 생성
    const created = await drive.files.create({
      requestBody: { name: "MemberChat", mimeType: FOLDER_MIME, parents: [rootId] },
      fields: "id"
    });
    chatFolderId = created.data.id;
  }

  // MemberChat/images 폴더 찾기
  const imgQ = `mimeType='${FOLDER_MIME}' and name='images' and '${chatFolderId}' in parents and trashed=false`;
  const imgRes = await drive.files.list({ q: imgQ, fields: "files(id,name)", pageSize: 1 });
  if (imgRes.data.files?.[0]) return imgRes.data.files[0].id;

  // images 폴더 생성
  const imgCreated = await drive.files.create({
    requestBody: { name: "images", mimeType: FOLDER_MIME, parents: [chatFolderId] },
    fields: "id"
  });
  return imgCreated.data.id;
}

async function getAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth 환경변수 미설정");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("access_token 획득 실패: " + JSON.stringify(d));
  return d.access_token;
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  try {
    const { parentId, fileName, mimeType, fileSize } = req.body || {};
    if (!fileName) return res.status(400).json({ ok: false, message: "fileName 필요" });

    // parentId가 'appDataFolder_MemberChat' 이거나 없으면 실제 폴더 자동 생성/탐색
    let realParentId = parentId;
    if (!parentId || parentId === "appDataFolder_MemberChat") {
      realParentId = await ensureMediaFolder();
    }

    const token = await getAccessToken();
    const mt = mimeType || "application/octet-stream";

    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webContentLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mt,
          ...(fileSize ? { "X-Upload-Content-Length": String(fileSize) } : {})
        },
        body: JSON.stringify({ name: String(fileName), parents: [realParentId], mimeType: mt })
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      return res.status(500).json({ ok: false, message: "Drive 업로드 세션 생성 실패", error: errText });
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) return res.status(500).json({ ok: false, message: "업로드 URL 발급 실패" });

    return res.status(200).json({ ok: true, uploadUrl, parentId: realParentId });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
