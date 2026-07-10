// lib/drive/json-store.js — Drive를 JSON 문서 저장소로 쓰는 계층. lib/drive-utils.js 분리의 일부.

import { getDrive, escapeQuery, cleanName, JSON_MIME, ALL_DRIVES, ALL_DRIVES_LIST } from "./client.js";
import { ensurePath, resolvePathIfExists } from "./folders.js";

const jsonName = (fileName) => cleanName(fileName.endsWith(".json") ? fileName : `${fileName}.json`);
const inFolder = (folderId) => `'${escapeQuery(folderId)}' in parents and mimeType='${JSON_MIME}' and trashed=false`;

// folderId 지정 시 경로 생성 없이 그 폴더를 직접 쓴다(노트 고정 폴더용).
const targetFolder = (folderId, folderPath) => (folderId ? { id: folderId } : ensurePath(folderPath));

export async function saveJsonToDrive({ folderPath = [], folderId, fileName, data = {} }) {
  const drive = getDrive();
  const folder = await targetFolder(folderId, folderPath);
  const name = jsonName(fileName);
  const body = JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2);
  const q = `name='${escapeQuery(name)}' and ${inFolder(folder.id)}`;
  const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1, ...ALL_DRIVES_LIST });
  if (found.data.files?.[0]) {
    const updated = await drive.files.update({
      fileId: found.data.files[0].id,
      media: { mimeType: JSON_MIME, body },
      fields: "id,name,webViewLink,modifiedTime",
    });
    return { action: "updated", ...updated.data };
  }
  const created = await drive.files.create({
    requestBody: { name, mimeType: JSON_MIME, parents: [folder.id] },
    media: { mimeType: JSON_MIME, body },
    fields: "id,name,webViewLink,modifiedTime",
  });
  return { action: "created", ...created.data };
}

async function listJsonIn(folderId, pageSize) {
  const drive = getDrive();
  const result = await drive.files.list({
    q: inFolder(folderId),
    fields: "files(id,name,webViewLink,modifiedTime,createdTime)",
    orderBy: "modifiedTime desc",
    pageSize,
    ...ALL_DRIVES_LIST,
  });
  return result.data.files || [];
}

export async function listJsonFromDrive({ folderPath = [], folderId, pageSize = 50 } = {}) {
  const folder = await targetFolder(folderId, folderPath);
  return listJsonIn(folder.id, pageSize);
}

/** listJsonFromDrive의 비생성 버전 — 경로가 없으면 폴더를 만들지 않고 빈 배열 반환. */
export async function listJsonIfExists({ folderPath = [], pageSize = 50 } = {}) {
  const folder = await resolvePathIfExists(folderPath);
  if (!folder) return [];
  return listJsonIn(folder.id, pageSize);
}

export async function readJsonFromDrive({ folderPath = [], folderId, fileName } = {}) {
  const drive = getDrive();
  const folder = await targetFolder(folderId, folderPath);
  const name = jsonName(fileName);
  const q = `name='${escapeQuery(name)}' and ${inFolder(folder.id)}`;
  const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1, ...ALL_DRIVES_LIST });
  const file = found.data.files?.[0];
  if (!file) return null;
  return { id: file.id, name: file.name, data: await readJsonById(file.id) };
}

/** 파일 ID로 JSON 내용을 직접 읽는다 — 목록에서 얻은 id 재사용으로 경로 재해석(ensurePath 체인)을 없앤다. */
export async function readJsonById(fileId) {
  const drive = getDrive();
  const res = await drive.files.get({ fileId, alt: "media", ...ALL_DRIVES }, { responseType: "text" });
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  return JSON.parse(text);
}

// 구 이름 별칭 (기존 호출부 호환)
export async function saveToDrive(data) { return saveJsonToDrive(data); }
export async function loadFromDrive(options = {}) { return listJsonFromDrive(options); }
