import { google } from "googleapis";

const JSON_MIME = "application/json";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

function envAny(names = []) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function mustEnvAny(names = []) {
  const value = envAny(names);
  if (!value) throw new Error(`${names[0]} not configured`);
  return value;
}

function mustEnv(name) {
  return mustEnvAny([name]);
}

export function getDriveRootId() {
  return mustEnvAny(["GOOGLE_DRIVE_FOLDER_ID", "STELLA_DRIVE_FOLDER_ID", "DRIVE_FOLDER_ID"]);
}

function getDrive() {
  const auth = new google.auth.OAuth2(
    mustEnv("GOOGLE_CLIENT_ID"),
    mustEnv("GOOGLE_CLIENT_SECRET"),
    process.env.GOOGLE_REDIRECT_URI || "https://developers.google.com/oauthplayground"
  );
  auth.setCredentials({
    refresh_token: mustEnvAny([
      "GOOGLE_REFRESH_TOKEN",
      "GOOGLE_DRIVE_REFRESH_TOKEN",
      "GOOGLE_OAUTH_REFRESH_TOKEN",
      "DRIVE_REFRESH_TOKEN"
    ])
  });
  return google.drive({ version: "v3", auth });
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
