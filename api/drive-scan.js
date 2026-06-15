// api/drive-scan.js
// Drive 전체 구조 진단 - 노트/게시글이 어디에 저장됐는지 추적
import { getDrive, getDriveRootId, FOLDER_MIME } from "../lib/drive-utils.js";

export const config = { maxDuration: 30 };

async function listChildren(drive, parentId, depth, maxDepth, result) {
  if (depth > maxDepth) return;
  const esc = (v) => String(v || "").replace(/'/g, "\\'");
  const r = await drive.files.list({
    q: `'${esc(parentId)}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,size)",
    pageSize: 200
  });
  for (const f of (r.data.files || [])) {
    const isFolder = f.mimeType === FOLDER_MIME;
    result.push({
      depth,
      name: f.name,
      id: f.id,
      type: isFolder ? "folder" : "file",
      mimeType: f.mimeType,
      size: f.size || ""
    });
    if (isFolder && depth < maxDepth) {
      await listChildren(drive, f.id, depth + 1, maxDepth, result);
    }
  }
}

export default async function handler(req, res) {
  try {
    const userId = String(req.query.userId || "").trim();
    const drive = getDrive();
    const rootId = getDriveRootId();
    const result = [];

    // 루트부터 3단계까지 스캔
    await listChildren(drive, rootId, 0, 3, result);

    // 노트로 추정되는 JSON 파일들 찾기
    const noteFiles = result.filter(f =>
      f.type === "file" &&
      f.name.endsWith(".json") &&
      (f.name.startsWith("note_") || result.some(p => p.name === "notes"))
    );

    // boards, users 폴더 위치
    const boardsFolder = result.find(f => f.name === "boards" && f.type === "folder");
    const usersFolder = result.find(f => f.name === "users" && f.type === "folder");

    return res.status(200).json({
      ok: true,
      rootId,
      userId,
      totalItems: result.length,
      hasBoardsFolder: !!boardsFolder,
      hasUsersFolder: !!usersFolder,
      tree: result,
      noteFilesGuess: noteFiles
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
