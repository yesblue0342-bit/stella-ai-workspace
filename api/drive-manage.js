import { google } from "googleapis";
import { unzipSync, strFromU8 } from "fflate";

// googleapis 기반 drive 인스턴스
function getDriveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

// OAuth2 access token 획득 (fetch 기반)
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

// fetch 기반 멀티파트 업로드
async function uploadFileToDrive({ parentId, fileName, mimeType, buf }) {
  const token = await getAccessToken();
  const mt = mimeType || "application/octet-stream";
  const boundary = "stella_upload_" + Date.now();
  const metadata = JSON.stringify({ name: String(fileName), parents: [parentId], mimeType: mt });
  const metaPart = [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", metadata, ""].join("\r\n");
  const filePart = [`--${boundary}`, `Content-Type: ${mt}`, "", ""].join("\r\n");
  const closing = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(metaPart, "utf-8"), Buffer.from(filePart, "utf-8"), buf, Buffer.from(closing, "utf-8")]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(body.length) }, body }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

// Drive에서 파일 다운로드 (base64)
async function downloadFileFromDrive(fileId) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`파일 다운로드 실패: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Drive에 폴더 생성
async function createFolder(drive, name, parentId) {
  const f = await drive.files.create({
    requestBody: { name: String(name).trim(), mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id,name"
  });
  return f.data;
}

// ZIP 압축 풀기 → Drive 업로드
async function unzipToDrive({ fileId, parentId }) {
  // 1. Drive에서 ZIP 파일 다운로드
  const zipBuf = await downloadFileFromDrive(fileId);
  const zipUint8 = new Uint8Array(zipBuf);

  // 2. fflate로 압축 해제
  const unzipped = unzipSync(zipUint8);
  const entries = Object.entries(unzipped);
  if (!entries.length) throw new Error("ZIP 파일이 비어있습니다.");

  const drive = getDriveClient();
  const folderCache = {}; // path → folderId
  folderCache[""] = parentId;

  let uploaded = 0;
  const errors = [];

  for (const [path, data] of entries) {
    try {
      // 디렉토리 엔트리 스킵 (data가 빈 배열이고 /로 끝나는 경우)
      if (path.endsWith("/") && data.length === 0) continue;
      // Mac OS X 메타데이터 스킵
      if (path.startsWith("__MACOSX/") || path.includes("/.DS_Store")) continue;

      const parts = path.split("/");
      const fileName = parts.pop();
      if (!fileName) continue;

      // 중간 폴더 생성
      let currentParentId = parentId;
      let pathSoFar = "";
      for (const part of parts) {
        if (!part) continue;
        pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
        if (!folderCache[pathSoFar]) {
          const folder = await createFolder(drive, part, currentParentId);
          folderCache[pathSoFar] = folder.id;
        }
        currentParentId = folderCache[pathSoFar];
      }

      // 파일 업로드
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      const mimeMap = {
        pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp", txt: "text/plain", csv: "text/csv",
        html: "text/html", js: "text/javascript", json: "application/json",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg"
      };
      const mimeType = mimeMap[ext] || "application/octet-stream";
      await uploadFileToDrive({ parentId: currentParentId, fileName, mimeType, buf: Buffer.from(data) });
      uploaded++;
    } catch (e) {
      errors.push(`${path}: ${e.message}`);
    }
  }

  return { uploaded, errors, total: entries.filter(([p]) => !p.endsWith("/")).length };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const action = String(req.query.action || req.body?.action || "").trim();

  // ── 파일 업로드 (base64) ──
  if (action === "upload") {
    try {
      const { parentId, fileName, mimeType, base64data } = req.body || {};
      if (!parentId || !fileName || !base64data) return res.status(400).json({ ok: false, message: "parentId, fileName, base64data 필요" });
      const buf = Buffer.from(base64data, "base64");
      const file = await uploadFileToDrive({ parentId, fileName, mimeType, buf });
      return res.status(200).json({ ok: true, file });
    } catch (e) {
      console.error("[drive-manage/upload]", e.message);
      return res.status(500).json({ ok: false, error: e.message, action });
    }
  }

  // ── ZIP 압축 풀기 ──
  if (action === "unzip") {
    try {
      const { fileId, parentId } = req.body || {};
      if (!fileId || !parentId) return res.status(400).json({ ok: false, message: "fileId, parentId 필요" });
      const result = await unzipToDrive({ fileId, parentId });
      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      console.error("[drive-manage/unzip]", e.message);
      return res.status(500).json({ ok: false, error: e.message, action });
    }
  }

  // ── 나머지 action (drive 클라이언트) ──
  try {
    const drive = getDriveClient();

    if (action === "mkdir") {
      const { parentId, name } = req.body || {};
      if (!parentId || !name) return res.status(400).json({ ok: false, message: "parentId, name 필요" });
      const f = await drive.files.create({
        requestBody: { name: String(name).trim(), mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
        fields: "id,name,mimeType,createdTime"
      });
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
      const ok = results.filter(r => r.status === "fulfilled").length;
      return res.status(200).json({ ok: true, deleted: ok, total: fileIds.length });
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
    console.error("[drive-manage]", e.message);
    return res.status(500).json({ ok: false, error: e.message, action });
  }
}
