import { google } from "googleapis";
import { repairMojibakePath } from "../lib/zipname.js";
import { sanitizeZipName, timestampName, dedupeZipPath } from "../lib/zipbuild.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

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
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`다운로드 실패: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 폴더 하위 파일을 재귀로 수집 (zip 내부 상대경로 basePath 유지). pageToken으로 대용량 폴더도 전부 순회.
// limits.maxFiles 초과 시 limits.truncated=true 로 표시하고 중단(서버 메모리 보호).
async function collectFolderFiles(drive, folderId, basePath, out, limits) {
  let pageToken = null;
  do {
    const resp = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,mimeType,size)",
      pageSize: 1000,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });
    const files = resp.data.files || [];
    for (const f of files) {
      if (out.count >= limits.maxFiles) { limits.truncated = true; return; }
      const rel = basePath ? `${basePath}/${f.name}` : f.name;
      if (f.mimeType === FOLDER_MIME) {
        await collectFolderFiles(drive, f.id, rel, out, limits);
        if (limits.truncated) return;
      } else if (String(f.mimeType || "").startsWith("application/vnd.google-apps")) {
        out.skipped.push(`${rel}: 구글 문서(내보내기 형식)는 압축에서 제외`);
      } else {
        const sz = Number(f.size || 0);
        if (sz > limits.perFileBytes) { out.skipped.push(`${rel}: 용량 초과(${Math.round(sz / 1048576)}MB) — 제외`); continue; }
        if (limits.bytes + sz > limits.maxBytes) { limits.truncated = true; return; }
        out.entries.push({ id: f.id, path: rel });
        out.count++; limits.bytes += sz;
      }
    }
    pageToken = resp.data.nextPageToken;
  } while (pageToken);
}

// 선택한 파일/폴더들을 하나의 ZIP으로 묶어 parentId 폴더에 업로드한다.
// 폴더는 재귀로 모든 하위 파일을 폴더명/상대경로 로 담는다. 구글 네이티브 문서는 제외(raw 불가).
async function zipToDrive({ fileIds, parentId, zipName }) {
  const { zip } = await import("fflate");
  const drive = getDriveClient();
  // 개수(maxFiles)·총용량(maxBytes)·단일파일(perFileBytes) 상한 — 단일 장수 OCI 프로세스 OOM 방지.
  // 메타의 size 를 미리 합산해 다운로드 전에 차단(이미 fields 로 받아옴).
  const limits = { maxFiles: 1500, maxBytes: 400 * 1024 * 1024, perFileBytes: 250 * 1024 * 1024, bytes: 0, truncated: false };
  const out = { entries: [], skipped: [], count: 0 };

  // 1) 선택 항목 메타 조회 → 파일/폴더 분기하여 엔트리 목록 구성
  for (const fid of fileIds) {
    try {
      const meta = await drive.files.get({ fileId: fid, fields: "id,name,mimeType,size", supportsAllDrives: true });
      const m = meta.data;
      if (out.count >= limits.maxFiles) { limits.truncated = true; break; }
      if (m.mimeType === FOLDER_MIME) {
        await collectFolderFiles(drive, m.id, m.name, out, limits);
        if (limits.truncated) break;
      } else if (String(m.mimeType || "").startsWith("application/vnd.google-apps")) {
        out.skipped.push(`${m.name}: 구글 문서(내보내기 형식)는 압축에서 제외`);
      } else {
        const sz = Number(m.size || 0);
        if (sz > limits.perFileBytes) { out.skipped.push(`${m.name}: 용량 초과(${Math.round(sz / 1048576)}MB) — 제외`); }
        else if (limits.bytes + sz > limits.maxBytes) { limits.truncated = true; break; }
        else { out.entries.push({ id: m.id, path: m.name }); out.count++; limits.bytes += sz; }
      }
    } catch (e) { out.skipped.push(`${fid}: ${e.message}`); }
  }

  if (!out.entries.length) {
    throw new Error("압축할 파일이 없습니다." + (out.skipped.length ? ` (${out.skipped[0]})` : ""));
  }

  // 2) 각 엔트리 바이트 다운로드 → zip 맵 구성 (경로 중복은 " (n)" 접미사로 회피)
  const fileMap = {};
  const used = new Set();
  for (const ent of out.entries) {
    try {
      const buf = await downloadFileFromDrive(ent.id);
      const p = dedupeZipPath(ent.path, used);
      fileMap[p] = new Uint8Array(buf);
    } catch (e) { out.skipped.push(`${ent.path}: ${e.message}`); }
  }
  if (!Object.keys(fileMap).length) throw new Error("파일 내용을 가져오지 못했습니다.");

  // 3) fflate 비동기 압축(이벤트 루프 비차단) → Drive 업로드
  const zipped = await new Promise((resolve, reject) => {
    zip(fileMap, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const name = sanitizeZipName(zipName) || timestampName(new Date());
  const file = await uploadFileToDrive({ parentId, fileName: name, mimeType: "application/zip", buf: Buffer.from(zipped) });
  return {
    file: { id: file.id, name: file.name },
    added: Object.keys(fileMap).length,
    total: out.count,
    truncated: limits.truncated,
    errors: out.skipped
  };
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

  // ── Resumable 업로드 완료 검증 (서버측 세션 상태 조회 — 브라우저 CORS 무관) ──
  // 브라우저가 Drive로 직접 PUT한 바이트는 도달했지만 응답을 못 읽어 "Failed to fetch"가 나는 경우,
  // 서버가 세션에 `Content-Range: bytes */total` 로 상태를 물어 실제 완료 여부를 확정한다.
  if (action === "upload-status") {
    try {
      const { uploadUrl, fileSize } = req.body || {};
      if (!uploadUrl) return res.status(400).json({ ok: false, message: "uploadUrl 필요" });
      // SSRF 방지: 서버가 PUT하는 대상은 Google 업로드 세션 URL로 제한
      if (!/^https:\/\/[a-z0-9.-]*\.googleapis\.com\//i.test(String(uploadUrl))) {
        return res.status(400).json({ ok: false, message: "허용되지 않은 uploadUrl" });
      }
      const total = Number(fileSize);
      const range = `bytes */${Number.isFinite(total) && total > 0 ? total : "*"}`;
      // redirect:"manual" — 만약 *.googleapis.com 이 타호스트로 3xx 리다이렉트해도 따라가지 않음(SSRF 가드 우회 방지).
      const r = await fetch(uploadUrl, { method: "PUT", redirect: "manual", headers: { "Content-Range": range } });
      if (r.status === 200 || r.status === 201) {
        let data = {};
        try { data = await r.json(); } catch (_) { /* ignore */ }
        return res.status(200).json({ ok: true, status: "complete", fileId: data.id || null, name: data.name || null, size: data.size || null });
      }
      if (r.status === 308) {
        const rg = r.headers.get("range");
        let received = 0;
        if (rg) { const m = /-(\d+)\s*$/.exec(rg); if (m) received = parseInt(m[1], 10) + 1; }
        return res.status(200).json({ ok: true, status: "incomplete", received });
      }
      // 404/410 = 세션 만료/소멸. 그 외 상태도 그대로 표면화.
      const txt = await r.text().catch(() => "");
      return res.status(200).json({ ok: true, status: "gone", httpStatus: r.status, body: String(txt).slice(0, 200) });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message, action }); }
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

  // ── ZIP 압축하기 (선택 파일·폴더 → 단일 zip, 현재 폴더에 저장) ──
  if (action === "zip") {
    try {
      const { fileIds, parentId, zipName } = req.body || {};
      if (!Array.isArray(fileIds) || !fileIds.length || !parentId) return res.status(400).json({ ok: false, message: "fileIds, parentId 필요" });
      const result = await zipToDrive({ fileIds, parentId, zipName });
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
