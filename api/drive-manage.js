import { google } from "googleapis";
import { repairMojibakePath } from "../lib/zipname.js";

// googleapis drive 인스턴스
function getDriveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

// OAuth2 access token
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
  if (!d.access_token) throw new Error("access_token 획득 실패");
  return d.access_token;
}

// fetch 멀티파트 업로드
async function uploadFileToDrive({ parentId, fileName, mimeType, buf }) {
  const token = await getAccessToken();
  const mt = mimeType || "application/octet-stream";
  const boundary = "stella_upload_" + Date.now();
  const metadata = JSON.stringify({ name: String(fileName), parents: [parentId], mimeType: mt });
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${mt}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(metaPart), Buffer.from(filePart), buf, Buffer.from(closing)]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(body.length) },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

// Drive 파일 다운로드
async function downloadFileFromDrive(fileId) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`다운로드 실패: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ZIP 압축 풀기 (fflate 동적 import)
async function unzipToDrive({ fileId, parentId }) {
  const { unzipSync } = await import("fflate");
  const zipBuf = await downloadFileFromDrive(fileId);
  const unzipped = unzipSync(new Uint8Array(zipBuf));
  const entries = Object.entries(unzipped);
  if (!entries.length) throw new Error("ZIP 파일이 비어있습니다.");

  const drive = getDriveClient();
  const folderCache = { "": parentId };
  let uploaded = 0;
  const errors = [];

  for (const [rawPath, data] of entries) {
    try {
      // 한글(CP949) 파일/폴더명 깨짐 복구 후 사용
      const path = repairMojibakePath(rawPath);
      if (path.endsWith("/") && data.length === 0) continue;
      if (path.startsWith("__MACOSX/") || path.includes("/.DS_Store")) continue;
      const parts = path.split("/");
      const fileName = parts.pop();
      if (!fileName) continue;

      let curParent = parentId;
      let pathSoFar = "";
      for (const part of parts) {
        if (!part) continue;
        pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
        if (!folderCache[pathSoFar]) {
          const f = await drive.files.create({ requestBody: { name: part, mimeType: "application/vnd.google-apps.folder", parents: [curParent] }, fields: "id,name" });
          folderCache[pathSoFar] = f.data.id;
        }
        curParent = folderCache[pathSoFar];
      }
      await uploadFileToDrive({ parentId: curParent, fileName, mimeType: "application/octet-stream", buf: Buffer.from(data) });
      uploaded++;
    } catch (e) { errors.push(`${rawPath}: ${e.message}`); }
  }
  return { uploaded, errors, total: entries.filter(([p]) => !p.endsWith("/")).length };
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const action = String(req.query.action || req.body?.action || "").trim();

  // ── Resumable Upload 세션 URL 발급 ──
  // 브라우저가 직접 Drive에 업로드 (용량 무제한)
  if (action === "upload-session") {
    try {
      const { parentId, fileName, mimeType, fileSize } = req.body || {};
      if (!parentId || !fileName) return res.status(400).json({ ok: false, message: "parentId, fileName 필요" });
      const token = await getAccessToken();
      const mt = mimeType || "application/octet-stream";
      const metadata = { name: String(fileName), parents: [parentId], mimeType: mt };
      const initRes = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": mt,
            ...(fileSize ? { "X-Upload-Content-Length": String(fileSize) } : {})
          },
          body: JSON.stringify(metadata)
        }
      );
      if (!initRes.ok) {
        const err = await initRes.text();
        return res.status(500).json({ ok: false, message: "세션 발급 실패", error: err });
      }
      const uploadUrl = initRes.headers.get("location");
      return res.status(200).json({ ok: true, uploadUrl });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // ── 소용량 업로드 (하위 호환 - 10MB 이하) ──
  if (action === "upload") {
    try {
      const { parentId, fileName, mimeType, base64data } = req.body || {};
      if (!parentId || !fileName || !base64data) return res.status(400).json({ ok: false, message: "parentId, fileName, base64data 필요" });
      const file = await uploadFileToDrive({ parentId, fileName, mimeType, buf: Buffer.from(base64data, "base64") });
      return res.status(200).json({ ok: true, file });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message, action }); }
  }

  // ── ZIP 압축풀기 ──
  if (action === "unzip") {
    try {
      const { fileId, parentId } = req.body || {};
      if (!fileId || !parentId) return res.status(400).json({ ok: false, message: "fileId, parentId 필요" });
      const result = await unzipToDrive({ fileId, parentId });
      return res.status(200).json({ ok: true, ...result });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message, action }); }
  }

  // ── 복사 (Drive API copy) ──
  if (action === "copy") {
    try {
      const { fileId, targetParentId, newName } = req.body || {};
      if (!fileId || !targetParentId) return res.status(400).json({ ok: false, message: "fileId, targetParentId 필요" });
      const drive = getDriveClient();
      const f = await drive.files.copy({
        fileId,
        requestBody: { parents: [targetParentId], ...(newName ? { name: newName } : {}) },
        fields: "id,name,parents"
      });
      return res.status(200).json({ ok: true, file: f.data });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message, action }); }
  }

  // ── 나머지 drive 클라이언트 액션 ──
  try {
    const drive = getDriveClient();

    if (action === "mkdir") {
      const { parentId, name } = req.body || {};
      if (!parentId || !name) return res.status(400).json({ ok: false, message: "parentId, name 필요" });
      const f = await drive.files.create({ requestBody: { name: String(name).trim(), mimeType: "application/vnd.google-apps.folder", parents: [parentId] }, fields: "id,name,mimeType,createdTime" });
      return res.status(200).json({ ok: true, file: f.data });
    }
    if (action === "delete") {
      const { fileId } = req.body || {};
      if (!fileId) return res.status(400).json({ ok: false, message: "fileId 필요" });
      await drive.files.update({ fileId, requestBody: { trashed: true } });
      return res.status(200).json({ ok: true, fileId });
    }
    if (action === "deleteMany") {
      const { fileIds } = req.body || {};
      if (!Array.isArray(fileIds) || !fileIds.length) return res.status(400).json({ ok: false, message: "fileIds 필요" });
      const results = await Promise.allSettled(fileIds.map(id => drive.files.update({ fileId: id, requestBody: { trashed: true } })));
      return res.status(200).json({ ok: true, deleted: results.filter(r => r.status === "fulfilled").length, total: fileIds.length });
    }
    if (action === "rename") {
      const { fileId, newName } = req.body || {};
      if (!fileId || !newName) return res.status(400).json({ ok: false, message: "fileId, newName 필요" });
      const f = await drive.files.update({ fileId, requestBody: { name: String(newName).trim() }, fields: "id,name" });
      return res.status(200).json({ ok: true, file: f.data });
    }
    if (action === "move") {
      const { fileId, newParentId, oldParentId } = req.body || {};
      if (!fileId || !newParentId) return res.status(400).json({ ok: false, message: "fileId, newParentId 필요" });
      const f = await drive.files.update({ fileId, addParents: newParentId, removeParents: oldParentId || "", requestBody: {}, fields: "id,name,parents" });
      return res.status(200).json({ ok: true, file: f.data });
    }
    return res.status(400).json({ ok: false, message: `알 수 없는 action: ${action}` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, action });
  }
}
