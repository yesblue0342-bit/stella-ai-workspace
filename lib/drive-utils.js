import { google } from "googleapis";

const JSON_MIME = "application/json";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

function normalizeEnvValue(value = "") {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
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

function getDrive() {
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
  return {
    configured: true,
    length: v.length,
    prefix: v.slice(0, type === "refreshToken" ? 4 : 10),
    suffix: v.slice(-8)
  };
}

export function normalizeDriveError(error) {
  const raw = error?.response?.data || error?.errors || error?.message || error;
  const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (/invalid_client/i.test(msg)) {
    return "Google OAuth invalid_client: GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET이 같은 OAuth 클라이언트 세트인지 확인하세요. API Key가 아니라 Client Secret(GOCSPX-...) 값이어야 합니다.";
  }
  if (/invalid_grant/i.test(msg)) {
    return "Google OAuth invalid_grant: GOOGLE_REFRESH_TOKEN이 만료/폐기되었거나 다른 OAuth 클라이언트에서 발급된 값입니다. 같은 Client ID/Secret으로 Refresh Token을 재발급해야 합니다.";
  }
  if (/not configured/i.test(msg)) return msg;
  return error?.message || msg || "Google Drive error";
}

function escapeQuery(value = "") {
  return String(value).replace(/'/g, "\\'");
}

function cleanName(value = "file") {
  return String(value || "file").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 150) || "file";
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
  const result = await drive.files.list({
    q,
    fields: "files(id,name,webViewLink,modifiedTime,createdTime)",
    orderBy: "modifiedTime desc",
    pageSize
  });
  return result.data.files || [];
}

export async function listDriveDirectory({ folderId, pageSize = 100 } = {}) {
  const drive = getDrive();
  const targetFolderId = folderId || getDriveRootId();
  const q = `'${escapeQuery(targetFolderId)}' in parents and trashed=false`;
  const result = await drive.files.list({
    q,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,createdTime,size,parents)",
    orderBy: "folder,name",
    pageSize
  });
  return (result.data.files || []).map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    isFolder: file.mimeType === FOLDER_MIME,
    link: file.webViewLink,
    modifiedTime: file.modifiedTime,
    createdTime: file.createdTime,
    size: file.size || null,
    parentId: targetFolderId
  }));
}

export async function searchDrive({ query, pageSize = 20 } = {}) {
  const drive = getDrive();
  const text = String(query || "").trim();
  if (!text) return [];
  const q = `trashed=false and (name contains '${escapeQuery(text)}' or fullText contains '${escapeQuery(text)}')`;
  const result = await drive.files.list({
    q,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
    orderBy: "modifiedTime desc",
    pageSize
  });
  return result.data.files || [];
}

export async function saveToDrive(data) {
  return saveJsonToDrive(data);
}

export async function loadFromDrive(options = {}) {
  return listJsonFromDrive(options);
}
