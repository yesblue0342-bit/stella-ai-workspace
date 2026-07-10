// lib/drive/folders.js — 폴더 탐색/생성/목록/검색 및 경로 해석. lib/drive-utils.js 분리의 일부.

import {
  getDrive, getRootIdFromEnv, escapeQuery, cleanName, normalizeFolderName, rootAlias,
  FOLDER_MIME, ALL_DRIVES_LIST,
} from "./client.js";
import { cleanupPathPart, detectDrivePathText } from "./detect.js";

export async function findFolderByName(name, parentId = "root") {
  const drive = getDrive();
  const folderName = normalizeFolderName(name);
  if (!folderName) return null;
  const q = `mimeType='${FOLDER_MIME}' and name='${escapeQuery(folderName)}' and '${escapeQuery(parentId)}' in parents and trashed=false`;
  const result = await drive.files.list({ q, fields: "files(id,name,mimeType,parents)", pageSize: 1, ...ALL_DRIVES_LIST });
  return result.data.files?.[0] || null;
}

// ★ 루트 폴더 ID 안전 해석 — env 미설정이어도 동작(폴더명 'StellaGPT' 자동 탐색→없으면 생성, 캐시).
//   Vercel→OCI 이관 때 .env 에 GOOGLE_DRIVE_FOLDER_ID 가 누락되어 2026-06-26 이후
//   모든 서버측 Drive 쓰기(ensurePath 계열: 채팅백업/노트/0Program)가 조용히 실패했던 사고의 근본 수정.
let _rootIdCache = null;
export async function getDriveRootIdSafe() {
  const v = getRootIdFromEnv();
  if (v) return v;
  if (_rootIdCache) return _rootIdCache;
  const found = await findFolderByName("StellaGPT", "root");
  if (found) return (_rootIdCache = found.id);
  const drive = getDrive();
  const created = await drive.files.create({
    requestBody: { name: "StellaGPT", mimeType: FOLDER_MIME, parents: ["root"] },
    fields: "id",
  });
  return (_rootIdCache = created.data.id);
}

async function resolveFolderTarget({ folderId, scope, folderName } = {}) {
  if (folderId) return { id: folderId, name: "선택 폴더", scope: "folder" };
  const rawScope = normalizeFolderName(scope || folderName || "");
  if (rootAlias(rawScope)) return { id: "root", name: "내 드라이브", scope: "root" };
  if (rawScope && !/^stellagpt$/i.test(rawScope)) {
    const folder = await findFolderByName(rawScope, "root");
    if (folder) return { id: folder.id, name: folder.name, scope: folder.name };
  }
  return { id: await getDriveRootIdSafe(), name: "StellaGPT", scope: "StellaGPT" };
}

async function ensureFolder(name, parentId) {
  const drive = getDrive();
  const safe = cleanName(name);
  const q = `mimeType='${FOLDER_MIME}' and name='${escapeQuery(safe)}' and '${escapeQuery(parentId)}' in parents and trashed=false`;
  const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1, ...ALL_DRIVES_LIST });
  if (found.data.files?.[0]) return found.data.files[0];
  const created = await drive.files.create({
    requestBody: { name: safe, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id,name",
  });
  return created.data;
}

/** 경로의 없는 폴더를 전부 생성하며 내려간다. 읽기 전용 코드는 resolvePathIfExists 를 쓸 것. */
export async function ensurePath(parts = []) {
  let parentId = await getDriveRootIdSafe();
  let folder = { id: parentId, name: "StellaGPT" };
  for (const part of parts.filter(Boolean)) {
    folder = await ensureFolder(part, parentId);
    parentId = folder.id;
  }
  return folder;
}

// ensurePath 의 비생성(non-creating) 버전 — 진단/읽기 전용 코드(note-scan 등)가 조회만 해도
// 빈 폴더가 Drive에 만들어지는 부작용을 막는다. 경로가 없으면 null.
export async function resolvePathIfExists(parts = []) {
  let parentId = await getDriveRootIdSafe();
  let folder = { id: parentId, name: "StellaGPT" };
  for (const part of (parts || []).filter(Boolean)) {
    const found = await findFolderByName(part, parentId);
    if (!found) return null;
    folder = found;
    parentId = found.id;
  }
  return folder;
}

export async function listDriveDirectory({ folderId, scope, folderName, pageSize = 100 } = {}) {
  const drive = getDrive();
  const target = await resolveFolderTarget({ folderId, scope, folderName });
  const q = `'${escapeQuery(target.id)}' in parents and trashed=false`;
  const result = await drive.files.list({
    q,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,createdTime,size,parents)",
    orderBy: "folder,name",
    pageSize,
    ...ALL_DRIVES_LIST,
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
      parentId: target.id,
    })),
  };
}

/** 이름/내용(fullText) 검색. 첫 인자로 문자열을 주면 query 로 해석한다(구 시그니처 호환). */
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
    pageSize,
    ...ALL_DRIVES_LIST,
  });
  return { folder: target, files: result.data.files || [] };
}

// 부모 폴더 안에서 이름 정확 일치 항목 1개를 찾는다(파일/폴더 무관). 없으면 null.
async function findChildByNameExact(parentId, name) {
  const drive = getDrive();
  const q = `name='${escapeQuery(name)}' and '${escapeQuery(parentId)}' in parents and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)", pageSize: 5, ...ALL_DRIVES_LIST });
  const f = (r.data.files || [])[0];
  if (!f) return null;
  return { id: f.id, name: f.name, mimeType: f.mimeType, isFolder: f.mimeType === FOLDER_MIME, link: f.webViewLink };
}

/**
 * "A > B > file.txt" 경로를 실제 Drive ID로 해석한다.
 * @returns {Promise<{folderId: string} | {fileId: string}>}
 */
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

    // 1차: 정확 이름 질의 — 세그먼트당 요청 1건으로 끝나고,
    //      자식이 200개를 넘는 폴더에서도 누락되지 않는다(기존 200개 목록 스캔의 한계 회피).
    current = await findChildByNameExact(parentId, want);

    // 2차 폴백: 기존 느슨한 매칭(공백/접두 일치) — 정확 일치가 없을 때만 목록을 읽는다.
    if (!current) {
      const listed = await listDriveDirectory({ folderId: parentId === "root" ? undefined : parentId, scope: parentId === "root" ? "root" : undefined, pageSize: 200 });
      const files = listed.files || [];
      current = files.find((f) => f.name === want)
        || files.find((f) => String(f.name || "").trim() === want)
        || files.find((f) => String(f.name || "").startsWith(want))
        || files.find((f) => want.startsWith(String(f.name || "")));
    }

    if (!current) throw new Error(`Drive 경로에서 찾지 못함: ${want}`);

    if (i < parts.length - 1) {
      if (!current.isFolder) throw new Error(`중간 경로가 폴더가 아닙니다: ${current.name}`);
      parentId = current.id;
    }
  }

  if (!current) return { folderId: "root" };
  return current.isFolder ? { folderId: current.id } : { fileId: current.id };
}
