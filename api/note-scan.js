// api/note-scan.js - 노트 복원 진단
import { getDrive, getDriveRootId, FOLDER_MIME, ensurePath, listDriveDirectory, readJsonFromDrive, listJsonFromDrive } from "../lib/drive-utils.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, message: 'userId 필요' });

  const result = { userId, found: [], paths: [] };

  // 1. users/{userId}/notes/ 확인
  try {
    const files = await listJsonFromDrive({ folderPath: ['users', userId, 'notes'], pageSize: 100 });
    result.paths.push({ path: `users/${userId}/notes`, count: files.length });
    for (const f of files.slice(0, 5)) {
      try {
        const r = await readJsonFromDrive({ folderPath: ['users', userId, 'notes'], fileName: f.name.replace(/\.json$/,'') });
        if (r?.data && !r.data.deleted) result.found.push({ path: `users/${userId}/notes`, id: r.data.id, title: r.data.title });
      } catch(e) {}
    }
  } catch(e) { result.paths.push({ path: `users/${userId}/notes`, error: e.message }); }

  // 2. Board/{userId}/노트/ 확인
  for (const root of ['Board', 'boards']) {
    for (const cat of ['노트', '게시글', 'Note']) {
      try {
        const files = await listJsonFromDrive({ folderPath: [root, userId, cat], pageSize: 50 });
        if (files.length) {
          result.paths.push({ path: `${root}/${userId}/${cat}`, count: files.length });
          for (const f of files.slice(0, 3)) {
            try {
              const r = await readJsonFromDrive({ folderPath: [root, userId, cat], fileName: f.name.replace(/\.json$/,'') });
              if (r?.data && !r.data.deleted) result.found.push({ path: `${root}/${userId}/${cat}`, id: r.data.id||r.data.postId, title: r.data.title });
            } catch(e) {}
          }
        }
      } catch(e) {}
    }
    // Board/노트/ (userId 없는 구조)
    try {
      const files = await listJsonFromDrive({ folderPath: [root, '노트'], pageSize: 50 });
      if (files.length) {
        result.paths.push({ path: `${root}/노트`, count: files.length });
        for (const f of files.slice(0, 3)) {
          try {
            const r = await readJsonFromDrive({ folderPath: [root, '노트'], fileName: f.name.replace(/\.json$/,'') });
            if (r?.data && !r.data.deleted && (r.data.userId === userId || !r.data.userId)) {
              result.found.push({ path: `${root}/노트`, id: r.data.id||r.data.postId, title: r.data.title });
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  return res.status(200).json({ ok: true, ...result, totalFound: result.found.length });
}
