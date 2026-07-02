// api/note-scan.js - 노트 복원 진단
// ⚠️ 읽기 전용 진단이 ensurePath 기반 list/read를 쓰면 조회한 모든 경로의 폴더가
//    Drive에 '생성'되는 부작용(빈 폴더 ~13개)이 있었다 → 비생성 조회로 전환.
//    또한 readJsonFromDrive의 경로 재해석(ensurePath 체인) 대신 목록의 파일 id로 바로 읽어
//    호출 수를 대폭 줄인다.
import { listJsonIfExists, readJsonById } from "../lib/drive-utils.js";

export default async function handler(req, res) {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, message: 'userId 필요' });

  const result = { userId, found: [], paths: [] };

  // 1. users/{userId}/notes/ 확인
  try {
    const files = await listJsonIfExists({ folderPath: ['users', userId, 'notes'], pageSize: 100 });
    result.paths.push({ path: `users/${userId}/notes`, count: files.length });
    for (const f of files.slice(0, 5)) {
      try {
        const data = await readJsonById(f.id);
        if (data && !data.deleted) result.found.push({ path: `users/${userId}/notes`, id: data.id, title: data.title });
      } catch(e) {}
    }
  } catch(e) { result.paths.push({ path: `users/${userId}/notes`, error: e.message }); }

  // 2. Board/{userId}/노트/ 확인
  for (const root of ['Board', 'boards']) {
    for (const cat of ['노트', '게시글', 'Note']) {
      try {
        const files = await listJsonIfExists({ folderPath: [root, userId, cat], pageSize: 50 });
        if (files.length) {
          result.paths.push({ path: `${root}/${userId}/${cat}`, count: files.length });
          for (const f of files.slice(0, 3)) {
            try {
              const data = await readJsonById(f.id);
              if (data && !data.deleted) result.found.push({ path: `${root}/${userId}/${cat}`, id: data.id||data.postId, title: data.title });
            } catch(e) {}
          }
        }
      } catch(e) {}
    }
    // Board/노트/ (userId 없는 구조)
    try {
      const files = await listJsonIfExists({ folderPath: [root, '노트'], pageSize: 50 });
      if (files.length) {
        result.paths.push({ path: `${root}/노트`, count: files.length });
        for (const f of files.slice(0, 3)) {
          try {
            const data = await readJsonById(f.id);
            if (data && !data.deleted && (data.userId === userId || !data.userId)) {
              result.found.push({ path: `${root}/노트`, id: data.id||data.postId, title: data.title });
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  return res.status(200).json({ ok: true, ...result, totalFound: result.found.length });
}
