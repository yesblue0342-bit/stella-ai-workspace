import { google } from "googleapis";
import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { createRequire } from "module";

// CJS 패키지를 ESM 환경에서 안전하게 로드 (Vercel type:module 대응)
const _require = createRequire(import.meta.url);

function loadMammoth() {
  try { return _require("mammoth"); } catch(e) { return null; }
}
// pdf-parse는 제거됨 (빌드 깨짐 유발) - PDF는 순수 JS로 추출

const JSON_MIME = "application/json";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE_MIME = "application/vnd.google-apps.presentation";
const GOOGLE_DRAWING_MIME = "application/vnd.google-apps.drawing";

function normalizeEnvValue(value = "") {
  return String(value || "")
    .trim()
    .replace(/^[']|[']$/g, "")
    .replace(/^[\"]|[\"]$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function envAny(names = []) {
  for (const name of names) {
    const value = normalizeEnvValue(process.env[name]);
    if (value) return value;
  }
  return "";
}

function mustEnvAny(names = []) {
  const value = envAny(names);
  if (!value) throw new Error(`${names[0]} not configured`);
  return value;
}

export function getDriveRootId() {
  return mustEnvAny(["GOOGLE_DRIVE_FOLDER_ID", "GOOGLE_FOLDER_ID", "STELLA_DRIVE_FOLDER_ID", "DRIVE_FOLDER_ID"]);
}

function driveEnv() {
  return {
    clientId: mustEnvAny(["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_ID"]),
    clientSecret: mustEnvAny(["GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_DRIVE_CLIENT_SECRET"]),
    refreshToken: mustEnvAny(["GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN", "DRIVE_REFRESH_TOKEN"]),
    redirectUri: envAny(["GOOGLE_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"]) || "https://developers.google.com/oauthplayground"
  };
}

export function getDrive() {
  const env = driveEnv();
  const auth = new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
  auth.setCredentials({ refresh_token: env.refreshToken });
  return google.drive({ version: "v3", auth });
}

export function getDriveEnvDiagnostics() {
  const clientId = envAny(["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_ID"]);
  const clientSecret = envAny(["GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_DRIVE_CLIENT_SECRET"]);
  const refreshToken = envAny(["GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN", "DRIVE_REFRESH_TOKEN"]);
  const rootId = envAny(["GOOGLE_DRIVE_FOLDER_ID", "GOOGLE_FOLDER_ID", "STELLA_DRIVE_FOLDER_ID", "DRIVE_FOLDER_ID"]);
  const redirectUri = envAny(["GOOGLE_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"]);
  return {
    clientId: describeSecret(clientId, "clientId"),
    clientSecret: describeSecret(clientSecret, "clientSecret"),
    refreshToken: describeSecret(refreshToken, "refreshToken"),
    rootFolderId: describeSecret(rootId, "folderId"),
    redirectUri: redirectUri || "https://developers.google.com/oauthplayground",
    checks: {
      clientIdLooksOAuth: /\.apps\.googleusercontent\.com$/.test(clientId),
      clientSecretLooksOAuth: /^GOCSPX-|^[A-Za-z0-9_-]{20,}$/.test(clientSecret) && !/^AIza/.test(clientSecret) && !/^sk_/.test(clientSecret),
      refreshTokenLooksGoogle: /^1\/\//.test(refreshToken),
      rootFolderConfigured: Boolean(rootId)
    }
  };
}

function describeSecret(value, type) {
  const v = normalizeEnvValue(value);
  if (!v) return { configured: false, length: 0, prefix: "", suffix: "" };
  return { configured: true, length: v.length, prefix: v.slice(0, type === "refreshToken" ? 4 : 10), suffix: v.slice(-8) };
}

export function normalizeDriveError(error) {
  const raw = error?.response?.data || error?.errors || error?.message || error;
  const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (/invalid_client/i.test(msg)) return "Google OAuth invalid_client: GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET이 같은 OAuth 클라이언트 세트인지 확인하세요.";
  if (/invalid_grant/i.test(msg)) return "Google OAuth invalid_grant: GOOGLE_REFRESH_TOKEN이 만료/폐기되었거나 다른 OAuth 클라이언트에서 발급된 값입니다.";
  if (/not configured/i.test(msg)) return msg;
  return error?.message || msg || "Google Drive error";
}

function escapeQuery(value = "") { return String(value).replace(/'/g, "\\'"); }
function cleanName(value = "file") { return String(value || "file").replace(/[\\/:*?\"<>|]/g, "_").trim().slice(0, 150) || "file"; }
function normalizeFolderName(value = "") { return String(value || "").trim().replace(/^#/, ""); }
function rootAlias(value = "") {
  const v = String(value || "").trim().toLowerCase();
  return v === "root" || v === "mydrive" || v === "drive" || v === "all" || v === "전체" || v === "내드라이브" || v === "내 드라이브";
}

export async function findFolderByName(name, parentId = "root") {
  const drive = getDrive();
  const folderName = normalizeFolderName(name);
  if (!folderName) return null;
  const q = `mimeType='${FOLDER_MIME}' and name='${escapeQuery(folderName)}' and '${escapeQuery(parentId)}' in parents and trashed=false`;
  const result = await drive.files.list({ q, fields: "files(id,name,mimeType,parents)", pageSize: 1 });
  return result.data.files?.[0] || null;
}

async function resolveFolderTarget({ folderId, scope, folderName } = {}) {
  if (folderId) return { id: folderId, name: "선택 폴더", scope: "folder" };
  const rawScope = normalizeFolderName(scope || folderName || "");
  if (rootAlias(rawScope)) return { id: "root", name: "내 드라이브", scope: "root" };
  if (rawScope && !/^stellagpt$/i.test(rawScope)) {
    const folder = await findFolderByName(rawScope, "root");
    if (folder) return { id: folder.id, name: folder.name, scope: folder.name };
  }
  return { id: getDriveRootId(), name: "StellaGPT", scope: "StellaGPT" };
}

async function ensureFolder(name, parentId) {
  const drive = getDrive();
  const safe = cleanName(name);
  const q = `mimeType='${FOLDER_MIME}' and name='${escapeQuery(safe)}' and '${escapeQuery(parentId)}' in parents and trashed=false`;
  const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  if (found.data.files?.[0]) return found.data.files[0];
  const created = await drive.files.create({
    requestBody: { name: safe, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id,name"
  });
  return created.data;
}

export async function ensurePath(parts = []) {
  let parentId = getDriveRootId();
  let folder = { id: parentId, name: "StellaGPT" };
  for (const part of parts.filter(Boolean)) {
    folder = await ensureFolder(part, parentId);
    parentId = folder.id;
  }
  return folder;
}

export async function saveJsonToDrive({ folderPath = [], fileName, data = {} }) {
  const drive = getDrive();
  const folder = await ensurePath(folderPath);
  const name = cleanName(fileName.endsWith(".json") ? fileName : `${fileName}.json`);
  const body = JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2);
  const q = `name='${escapeQuery(name)}' and '${escapeQuery(folder.id)}' in parents and mimeType='${JSON_MIME}' and trashed=false`;
  const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  if (found.data.files?.[0]) {
    const updated = await drive.files.update({
      fileId: found.data.files[0].id,
      media: { mimeType: JSON_MIME, body },
      fields: "id,name,webViewLink,modifiedTime"
    });
    return { action: "updated", ...updated.data };
  }
  const created = await drive.files.create({
    requestBody: { name, mimeType: JSON_MIME, parents: [folder.id] },
    media: { mimeType: JSON_MIME, body },
    fields: "id,name,webViewLink,modifiedTime"
  });
  return { action: "created", ...created.data };
}

export async function listJsonFromDrive({ folderPath = [], pageSize = 50 } = {}) {
  const drive = getDrive();
  const folder = await ensurePath(folderPath);
  const q = `'${escapeQuery(folder.id)}' in parents and mimeType='${JSON_MIME}' and trashed=false`;
  const result = await drive.files.list({ q, fields: "files(id,name,webViewLink,modifiedTime,createdTime)", orderBy: "modifiedTime desc", pageSize });
  return result.data.files || [];
}

export async function readJsonFromDrive({ folderPath = [], fileName } = {}) {
  const drive = getDrive();
  const folder = await ensurePath(folderPath);
  const name = cleanName(fileName.endsWith(".json") ? fileName : `${fileName}.json`);
  const q = `name='${escapeQuery(name)}' and '${escapeQuery(folder.id)}' in parents and mimeType='${JSON_MIME}' and trashed=false`;
  const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  const file = found.data.files?.[0];
  if (!file) return null;
  const res = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "text" });
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  return { id: file.id, name: file.name, data: JSON.parse(text) };
}

export async function listDriveDirectory({ folderId, scope, folderName, pageSize = 100 } = {}) {
  const drive = getDrive();
  const target = await resolveFolderTarget({ folderId, scope, folderName });
  const q = `'${escapeQuery(target.id)}' in parents and trashed=false`;
  const result = await drive.files.list({
    q,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,createdTime,size,parents)",
    orderBy: "folder,name",
    pageSize
  });
  return {
    folder: target,
    files: (result.data.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      isFolder: file.mimeType === FOLDER_MIME,
      link: file.webViewLink,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      size: file.size || null,
      parentId: target.id
    }))
  };
}

export async function searchDrive(arg = {}, maybeOptions = {}) {
  const options = typeof arg === "string" ? { ...maybeOptions, query: arg } : arg;
  const { query, pageSize = 20, scope, folderName, folderId } = options;
  const drive = getDrive();
  const text = String(query || "").trim();
  if (!text) return { folder: null, files: [] };
  const target = await resolveFolderTarget({ folderId, scope, folderName });
  const parentClause = target.id === "root" && rootAlias(scope) ? "" : ` and '${escapeQuery(target.id)}' in parents`;
  const q = `trashed=false${parentClause} and (name contains '${escapeQuery(text)}' or fullText contains '${escapeQuery(text)}')`;
  const result = await drive.files.list({
    q,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
    orderBy: "modifiedTime desc",
    pageSize
  });
  return { folder: target, files: result.data.files || [] };
}

export async function saveToDrive(data) { return saveJsonToDrive(data); }
export async function loadFromDrive(options = {}) { return listJsonFromDrive(options); }

// ─────────────────────────────────────────────
// 실제 Google Drive 파일 내용 읽기 / 추출
// ─────────────────────────────────────────────

function clip(text = "", max = 30000) {
  const s = String(text || "").replace(/\u0000/g, "").trim();
  return s.length > max ? s.slice(0, max) + "\n\n...[내용 일부 생략]" : s;
}

function bufferToText(buffer) {
  return Buffer.from(buffer || []).toString("utf8");
}

function stripXml(xml = "") {
  return String(xml || "")
    .replace(/<a:t>/g, "")
    .replace(/<\/a:t>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function getFileMeta(fileId) {
  const drive = getDrive();
  const r = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,webViewLink,modifiedTime,createdTime,size,parents"
  });
  return r.data;
}

async function downloadBuffer(fileId) {
  const drive = getDrive();
  const r = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(r.data);
}

async function exportGoogleFile(file) {
  const drive = getDrive();
  let exportMime = "text/plain";
  if (file.mimeType === GOOGLE_SHEET_MIME) exportMime = "text/csv";
  if (file.mimeType === GOOGLE_SLIDE_MIME) exportMime = "text/plain";
  if (file.mimeType === GOOGLE_DRAWING_MIME) exportMime = "image/svg+xml";

  try {
    const r = await drive.files.export(
      { fileId: file.id, mimeType: exportMime },
      { responseType: "arraybuffer" }
    );
    const text = bufferToText(r.data);
    return text;
  } catch (e) {
    // export 실패 시 text/plain 재시도
    if (exportMime !== "text/plain") {
      const r2 = await drive.files.export(
        { fileId: file.id, mimeType: "text/plain" },
        { responseType: "arraybuffer" }
      );
      return bufferToText(r2.data);
    }
    throw e;
  }
}

function extractXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts = [];
  for (const sheetName of wb.SheetNames.slice(0, 20)) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false });
    const lines = rows.slice(0, 500).map(row => row.map(v => String(v ?? "").trim()).join("\t")).filter(Boolean);
    if (lines.length) parts.push(`[Sheet: ${sheetName}]\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

async function extractDocx(buffer) {
  // 방법1: createRequire로 mammoth CJS 로드 (Vercel ESM 환경 대응)
  try {
    const mammoth = loadMammoth();
    if (mammoth) {
      // mammoth는 Buffer 또는 ArrayBuffer 모두 지원
      try {
        const r = await mammoth.extractRawText({ buffer });
        if (r && r.value && r.value.trim()) return r.value;
      } catch(e1) {}
      // ArrayBuffer 방식 재시도
      try {
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const r = await mammoth.extractRawText({ arrayBuffer });
        if (r && r.value && r.value.trim()) return r.value;
      } catch(e2) {}
    }
  } catch(e) {}

  // 방법2: fflate로 word/document.xml 직접 파싱 (외부 의존성 없음, 항상 동작)
  try {
    const zip = unzipSync(new Uint8Array(buffer));
    // document.xml 외에 header/footer도 포함
    const xmlKeys = Object.keys(zip).filter(k =>
      k === "word/document.xml" ||
      /^word\/(header|footer)\d*\.xml$/.test(k)
    );
    const allTexts = [];
    for (const key of xmlKeys) {
      const xml = strFromU8(zip[key]);
      // 문단 단위로 줄바꿈 처리하면서 w:t 추출
      // </w:p> = 문단 끝 = 줄바꿈
      const paragraphs = xml.split(/<\/w:p>/);
      for (const para of paragraphs) {
        const texts = [];
        const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let m;
        while ((m = re.exec(para)) !== null) {
          if (m[1]) texts.push(m[1]);
        }
        const line = texts.join("").trim();
        if (line) allTexts.push(line);
      }
    }
    if (allTexts.length) {
      // HTML 엔티티 디코딩
      return allTexts.join("\n")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
    }
  } catch(e2) {
    console.error("[drive-utils] docx fflate 추출 실패:", e2.message);
  }

  return "";
}

async function extractPdf(buffer) {
  // PDF 스트림에서 텍스트 직접 추출 (순수 JS, 외부 패키지 불필요)
  try {
    const str = buffer.toString("latin1");
    const texts = [];

    // Tj / TJ 연산자 처리
    const re = /BT[\s\S]*?ET/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const block = m[0];

      // (text) Tj 형식
      const tj = block.match(/\(([^)]*)\)\s*Tj/g) || [];
      tj.forEach(t => {
        const inner = t.match(/\(([^)]*)\)/);
        if (inner && inner[1].trim()) texts.push(inner[1]);
      });

      // [(text)-spacing(text)] TJ 형식
      const tjArr = block.match(/\[([^\]]*)\]\s*TJ/g) || [];
      tjArr.forEach(t => {
        const parts = t.match(/\(([^)]*)\)/g) || [];
        parts.forEach(p => {
          const inner = p.replace(/^\(|\)$/g, "");
          if (inner.trim()) texts.push(inner);
        });
      });
    }

    if (texts.length > 0) {
      return texts
        .join(" ")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .trim();
    }
  } catch(e2) {}

  return "";
}

function extractPptx(buffer) {
  const zip = unzipSync(new Uint8Array(buffer));
  const slideKeys = Object.keys(zip)
    .filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return na - nb;
    });

  const slides = slideKeys.map((key, i) => {
    const xml = strFromU8(zip[key]);
    const text = stripXml(xml);
    return text ? `[Slide ${i + 1}]\n${text}` : "";
  }).filter(Boolean);

  return slides.join("\n\n");
}

async function extractRegularFileText(file, buffer) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.mimeType || "").toLowerCase();

  if (/\.(txt|csv|json|xml|html|htm|md|js|ts|css|sql|abap)$/i.test(name) ||
      /^text\//.test(mime) ||
      /json|xml|csv|javascript|html/.test(mime)) {
    return bufferToText(buffer);
  }

  if (/\.(xlsx|xls|xlsm|csv)$/i.test(name) || /spreadsheet|excel/.test(mime)) {
    return extractXlsx(buffer);
  }

  if (/\.docx$/i.test(name) || /wordprocessingml/.test(mime)) {
    return await extractDocx(buffer);
  }

  if (/\.pdf$/i.test(name) || mime === "application/pdf") {
    return await extractPdf(buffer);
  }

  if (/\.pptx$/i.test(name) || /presentationml/.test(mime)) {
    return extractPptx(buffer);
  }

  return "";
}

export async function extractDriveFileText(fileId) {
  const file = await getFileMeta(fileId);

  if (file.mimeType === FOLDER_MIME) {
    return { ...file, isFolder: true, read: false, text: "", error: "폴더는 파일 내용이 없습니다." };
  }

  try {
    let text = "";
    const mime = String(file.mimeType || "");
    const fname = String(file.name || "").toLowerCase();
    if (mime.startsWith("application/vnd.google-apps.")) {
      text = await exportGoogleFile(file);
    } else {
      const buffer = await downloadBuffer(file.id);
      text = await extractRegularFileText(file, buffer);
    }

    if (!text || !String(text).trim()) {
      // mimeType 힌트 포함 오류 메시지
      const hint = mime || fname;
      return { ...file, isFolder: false, read: false, text: "", error: `파일 내용을 읽지 못했습니다 (${hint})` };
    }

    return { ...file, isFolder: false, read: true, text: clip(text) };
  } catch (error) {
    const errMsg = normalizeDriveError(error);
    console.error("[drive-utils] extractDriveFileText 오류:", file.name, errMsg);
    return { ...file, isFolder: false, read: false, text: "", error: errMsg };
  }
}

export async function readDriveTarget({ fileId, folderId, recursive = false, maxFiles = 20 } = {}) {
  if (fileId) {
    const file = await extractDriveFileText(fileId);
    return {
      target: { id: fileId, name: file.name || "", mimeType: file.mimeType || "", type: "file" },
      files: [file],
      readCount: file.read ? 1 : 0,
      unreadCount: file.read ? 0 : 1
    };
  }

  if (!folderId) throw new Error("fileId 또는 folderId가 필요합니다.");

  const folderMeta = folderId === "root"
    ? { id: "root", name: "내 드라이브", mimeType: FOLDER_MIME }
    : await getFileMeta(folderId);

  const queue = [{ id: folderId, path: folderMeta.name || "선택 폴더" }];
  const collected = [];

  while (queue.length && collected.length < maxFiles) {
    const cur = queue.shift();
    const listed = await listDriveDirectory({ folderId: cur.id === "root" ? undefined : cur.id, scope: cur.id === "root" ? "root" : undefined, pageSize: 100 });
    for (const item of listed.files || []) {
      if (item.isFolder) {
        if (recursive) queue.push({ id: item.id, path: `${cur.path}/${item.name}` });
        continue;
      }
      collected.push(item);
      if (collected.length >= maxFiles) break;
    }
  }

  const files = [];
  for (const item of collected) {
    files.push(await extractDriveFileText(item.id));
  }

  return {
    target: { id: folderId, name: folderMeta.name || "선택 폴더", mimeType: FOLDER_MIME, type: "folder" },
    files,
    readCount: files.filter(f => f.read).length,
    unreadCount: files.filter(f => !f.read).length
  };
}

function cleanupPathPart(part = "") {
  return String(part || "")
    .replace(/\s*(파일들|파일|폴더)?\s*(을|를)?\s*(리뷰|분석|요약|정리|확인)\s*(해줘|해주세요|해|바랍니다)?\.?$/i, "")
    .trim();
}

export function detectDrivePathText(message = "") {
  const raw = String(message || "");

  // ★ # 으로 시작하는 입력을 폴더/파일 경로로 인식 (#폴더명 또는 #폴더 > 하위)
  // 예: "#Stella GPT 개발 메모" → 해당 폴더 읽기
  const hashLine = raw.split(/\r?\n/).find(l => l.trim().startsWith("#"));
  if (hashLine) {
    const afterHash = hashLine.trim().replace(/^#+\s*/, "").trim();
    // 명령성 꼬리말 제거 (예: "파일 리스트와 ... 요약해줘" 같은 자연어 지시 제거)
    // '>' 기준 경로는 유지, 첫 구문만 폴더명으로 사용
    if (afterHash) {
      // 자연어 지시어가 붙어있으면 폴더명만 추출 (한글/영문/숫자/공백/언더바/점 허용, 조사·동사 전까지)
      const folderName = afterHash.split(/\s+(?:파일|리스트|읽고|읽어|분석|요약|정리|내용|을|를|에서|폴더의|안의|에)\b/)[0].trim();
      const parts = (folderName || afterHash).split(">").map(cleanupPathPart).filter(Boolean);
      if (parts.length) return parts.join(" > ");
    }
  }

  if (!raw.includes("내 드라이브") && !raw.includes("My Drive")) return "";
  const line = raw.split(/\r?\n/).find(l => l.includes("내 드라이브") || l.includes("My Drive")) || raw;
  const startIdx = line.includes("내 드라이브") ? line.indexOf("내 드라이브") : line.indexOf("My Drive");
  const sliced = line.slice(startIdx).trim();
  const parts = sliced.split(">").map(cleanupPathPart).filter(Boolean);
  return parts.join(" > ");
}

export async function resolveDrivePath(pathText = "") {
  const path = detectDrivePathText(pathText) || String(pathText || "").trim();
  const parts = path.split(">").map(cleanupPathPart).filter(Boolean);
  if (!parts.length) throw new Error("Drive 경로를 인식하지 못했습니다.");

  if (/^(내 드라이브|my drive)$/i.test(parts[0])) parts.shift();
  if (!parts.length) return { folderId: "root" };

  let parentId = "root";
  let current = null;

  for (let i = 0; i < parts.length; i++) {
    const want = cleanupPathPart(parts[i]);
    const listed = await listDriveDirectory({ folderId: parentId === "root" ? undefined : parentId, scope: parentId === "root" ? "root" : undefined, pageSize: 200 });
    const files = listed.files || [];

    current = files.find(f => f.name === want)
      || files.find(f => String(f.name || "").trim() === want)
      || files.find(f => String(f.name || "").startsWith(want))
      || files.find(f => want.startsWith(String(f.name || "")));

    if (!current) {
      throw new Error(`Drive 경로에서 찾지 못함: ${want}`);
    }

    if (i < parts.length - 1) {
      if (!current.isFolder) throw new Error(`중간 경로가 폴더가 아닙니다: ${current.name}`);
      parentId = current.id;
    }
  }

  if (!current) return { folderId: "root" };
  return current.isFolder ? { folderId: current.id } : { fileId: current.id };
}

export async function buildDriveContextForChat(message = {}) {
  const msg = typeof message === "string" ? message : String(message?.message || "");
  const path = detectDrivePathText(msg);
  if (!path) return null;

  const target = await resolveDrivePath(path);
  const data = await readDriveTarget({ ...target, recursive: false, maxFiles: 20 });

  const readFiles = (data.files || []).filter(f => f.read && f.text);
  const unreadFiles = (data.files || []).filter(f => !f.read || !f.text);

  const readList = readFiles.map((f, i) =>
    `--- 읽은 파일 ${i + 1}: ${f.name} (${f.mimeType || ""}) ---\n${f.text}`
  ).join("\n\n");

  const unreadList = unreadFiles.length
    ? "\n\n[읽지 못한 파일]\n" + unreadFiles.map(f => `- ${f.name || f.id}: ${f.error || "파일 내용을 읽지 못했습니다"}`).join("\n")
    : "";

  return {
    path,
    target: data.target,
    files: data.files || [],
    prompt:
`\n\n[STELLA_GOOGLE_DRIVE_CONTEXT]
요청자가 입력한 경로: ${path}
실제로 읽은 파일 수: ${readFiles.length}
${readList || "파일 내용을 읽지 못했습니다."}${unreadList}
[/STELLA_GOOGLE_DRIVE_CONTEXT]

중요 규칙:
- 위 Google Drive 실제 파일 내용만 근거로 답하세요.
- 파일 내용을 읽지 못한 항목은 추측하지 말고 "파일 내용을 읽지 못했습니다"라고 표시하세요.
- 경로명만 보고 내용을 만들어내면 안 됩니다.`
  };
}
