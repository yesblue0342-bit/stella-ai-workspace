// lib/drive/read.js — Drive 파일/폴더를 실제로 읽어 텍스트로 만든다. lib/drive-utils.js 분리의 일부.

import {
  getDrive, normalizeDriveError, FOLDER_MIME, ALL_DRIVES,
  GOOGLE_SHEET_MIME, GOOGLE_SLIDE_MIME, GOOGLE_DRAWING_MIME,
} from "./client.js";
import { listDriveDirectory } from "./folders.js";
import { bufferToText, extractRegularFileText, isExtractableDriveFile } from "./file-text.js";

export { isExtractableDriveFile };

// 전체 파일을 RAM에 받는 구조라 대용량은 다운로드 전에 차단 (컨테이너 OOM/대역폭 낭비 방지)
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";

function clip(text = "", max = 30000) {
  const s = String(text || "").replace(/\u0000/g, "").trim();
  return s.length > max ? s.slice(0, max) + "\n\n...[내용 일부 생략]" : s;
}

async function getFileMeta(fileId) {
  const drive = getDrive();
  const r = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,webViewLink,modifiedTime,createdTime,size,parents",
    ...ALL_DRIVES,
  });
  return r.data;
}

async function downloadBuffer(fileId) {
  const drive = getDrive();
  const r = await drive.files.get({ fileId, alt: "media", ...ALL_DRIVES }, { responseType: "arraybuffer" });
  return Buffer.from(r.data);
}

// Google Docs/Sheets/Slides 는 다운로드가 아니라 export 로 텍스트를 얻는다.
async function exportGoogleFile(file) {
  const drive = getDrive();
  let exportMime = "text/plain";
  if (file.mimeType === GOOGLE_SHEET_MIME) exportMime = "text/csv";
  if (file.mimeType === GOOGLE_SLIDE_MIME) exportMime = "text/plain";
  if (file.mimeType === GOOGLE_DRAWING_MIME) exportMime = "image/svg+xml";

  try {
    const r = await drive.files.export({ fileId: file.id, mimeType: exportMime, ...ALL_DRIVES }, { responseType: "arraybuffer" });
    return bufferToText(r.data);
  } catch (e) {
    if (exportMime === "text/plain") throw e;
    const r2 = await drive.files.export({ fileId: file.id, mimeType: "text/plain", ...ALL_DRIVES }, { responseType: "arraybuffer" });
    return bufferToText(r2.data);
  }
}

/**
 * 파일 ID 하나의 텍스트를 추출한다. 실패해도 던지지 않고 { read:false, error } 를 반환해
 * 호출부가 "읽지 못했다"고 정직하게 답할 수 있게 한다.
 * @returns {Promise<{id: string, name: string, mimeType: string, isFolder: boolean, read: boolean, text: string, error?: string}>}
 */
export async function extractDriveFileText(fileId) {
  const file = await getFileMeta(fileId);

  if (file.mimeType === FOLDER_MIME) {
    return { ...file, isFolder: true, read: false, text: "", error: "폴더는 파일 내용이 없습니다." };
  }

  try {
    const mime = String(file.mimeType || "");
    const fname = String(file.name || "").toLowerCase();
    const isGoogleNative = mime.startsWith(GOOGLE_NATIVE_PREFIX);

    if (!isGoogleNative) {
      const size = Number(file.size || 0);
      if (size > MAX_DOWNLOAD_BYTES) {
        return { ...file, isFolder: false, read: false, text: "", error: `파일이 너무 큽니다(${Math.round(size / 1048576)}MB > 10MB) — 다운로드 생략. 링크로 열어보세요.` };
      }
      if (!isExtractableDriveFile(file)) {
        return { ...file, isFolder: false, read: false, text: "", error: `텍스트 추출 미지원 형식(${mime || fname}) — 다운로드 생략` };
      }
    }

    const text = isGoogleNative
      ? await exportGoogleFile(file)
      : await extractRegularFileText(file, await downloadBuffer(file.id));

    if (!text || !String(text).trim()) {
      return { ...file, isFolder: false, read: false, text: "", error: `파일 내용을 읽지 못했습니다 (${mime || fname})` };
    }
    return { ...file, isFolder: false, read: true, text: clip(text) };
  } catch (error) {
    const errMsg = normalizeDriveError(error);
    console.error("[drive/read] extractDriveFileText 오류:", file.name, errMsg);
    return { ...file, isFolder: false, read: false, text: "", error: errMsg };
  }
}

// 폴더를 너비 우선으로 훑어 maxFiles 개까지 파일 항목을 모은다(recursive=false면 최상위만).
async function collectFolderFiles(folderId, folderName, recursive, maxFiles) {
  const queue = [{ id: folderId, path: folderName || "선택 폴더" }];
  const collected = [];
  while (queue.length && collected.length < maxFiles) {
    const cur = queue.shift();
    const listed = await listDriveDirectory({
      folderId: cur.id === "root" ? undefined : cur.id,
      scope: cur.id === "root" ? "root" : undefined,
      pageSize: 100,
    });
    for (const item of listed.files || []) {
      if (item.isFolder) {
        if (recursive) queue.push({ id: item.id, path: `${cur.path}/${item.name}` });
        continue;
      }
      collected.push(item);
      if (collected.length >= maxFiles) break;
    }
  }
  return collected;
}

/**
 * 파일 하나 또는 폴더 하나를 읽어 파일별 텍스트 배열을 만든다.
 * @param {{fileId?: string, folderId?: string, recursive?: boolean, maxFiles?: number}} args
 */
export async function readDriveTarget({ fileId, folderId, recursive = false, maxFiles = 20 } = {}) {
  if (fileId) {
    const file = await extractDriveFileText(fileId);
    return {
      target: { id: fileId, name: file.name || "", mimeType: file.mimeType || "", type: "file" },
      files: [file],
      readCount: file.read ? 1 : 0,
      unreadCount: file.read ? 0 : 1,
    };
  }

  if (!folderId) throw new Error("fileId 또는 folderId가 필요합니다.");

  const folderMeta = folderId === "root"
    ? { id: "root", name: "내 드라이브", mimeType: FOLDER_MIME }
    : await getFileMeta(folderId);

  const collected = await collectFolderFiles(folderId, folderMeta.name, recursive, maxFiles);
  const files = [];
  for (const item of collected) files.push(await extractDriveFileText(item.id));

  return {
    target: { id: folderId, name: folderMeta.name || "선택 폴더", mimeType: FOLDER_MIME, type: "folder" },
    files,
    readCount: files.filter((f) => f.read).length,
    unreadCount: files.filter((f) => !f.read).length,
  };
}
