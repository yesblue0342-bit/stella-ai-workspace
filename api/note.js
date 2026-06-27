import { saveJsonToDrive, listJsonFromDrive, readJsonFromDrive, listDriveDirectory, ensurePath } from "../lib/drive-utils.js";
// 노트가 저장될 수 있는 모든 레거시 루트 폴더명
// "Board"(대문자, 구버전 board-save), "boards"(소문자) 모두 탐색
const LEGACY_ROOTS = ["Board", "boards"];

// 특정 루트 폴더 하위의 모든 카테고리에서 노트 JSON 읽기
async function readNotesFromRoot(rootName, userId, noteMap) {
  try {
    // 구조1: {root}/{userId}/{category}/*.json
    const userRoot = await ensurePath([rootName, userId]).catch(() => null);
    if (userRoot?.id) {
      const catList = await listDriveDirectory({ folderId: userRoot.id, pageSize: 100 });
      const categories = (catList.files || []).filter(f => f.isFolder).map(f => f.name);
      // 카테고리 폴더가 있으면 그 안을 읽고, 없으면 userRoot 직속 파일도 읽기
      const targets = categories.length ? categories.map(c => [rootName, userId, c]) : [[rootName, userId]];
      for (const fp of targets) {
        await collectNotes(fp, noteMap);
      }
    }
  } catch(e) {}

  try {
    // 구조2: {root}/{category}/*.json  (userId 폴더 없이 카테고리 바로)
    // 예: Board/노트/*.json
    const root = await ensurePath([rootName]).catch(() => null);
    if (root?.id) {
      const catList = await listDriveDirectory({ folderId: root.id, pageSize: 100 });
      const categories = (catList.files || []).filter(f => f.isFolder).map(f => f.name);
      for (const cat of categories) {
        // userId 폴더는 위에서 처리했으므로 스킵
        if (cat === userId) continue;
        await collectNotes([rootName, cat], noteMap, userId);
      }
    }
  } catch(e) {}
}

// folderPath 하위의 노트 JSON들을 noteMap에 수집 (userId 필터 옵션)
async function collectNotes(folderPath, noteMap, filterUserId = null) {
  try {
    const files = await listJsonFromDrive({ folderPath, pageSize: 100 });
    // 병렬 처리 (최대 10개씩 배치) - 타임아웃 방지
    const BATCH = 10;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async function(f) {
        try {
          const fileName = f.name.replace(/\.json$/, "");
          const r = await readJsonFromDrive({ folderPath, fileName });
          return { r, fileName };
        } catch(e) { return null; }
      }));
      for (const item of results) {
        if (!item || !item.r?.data || item.r.data.deleted) continue;
        const r = item.r;
        if (filterUserId && r.data.userId && r.data.userId !== filterUserId) continue;
        const id = r.data.id || r.data.postId || item.fileName;
        if (!noteMap.has(id)) {
          noteMap.set(id, {
            id,
            title: r.data.title || "(제목없음)",
            body: r.data.body || r.data.content || "",
            category: r.data.category || "노트",
            createdAt: r.data.createdAt,
            updatedAt: r.data.updatedAt || r.data.createdAt,
            deleted: false
          });
        }
      }
    }
  } catch(e) {}
}

export default async function handler(req, res) {
  const action = String(req.query.action || req.body?.action || "list").trim();
  const userId = String(req.query.userId || req.body?.userId || "").trim();
  if (!userId) return res.status(400).json({ ok: false, message: "userId 필요" });

  const notesPath = ["users", userId, "notes"];

  try {
    // ── 목록 조회 (users/notes + Board + boards 모든 경로 통합) ──
    if (action === "list") {
      const noteMap = new Map();

      // 1) 표준 경로: users/{userId}/notes/
      await collectNotes(notesPath, noteMap);

      // 2) 레거시 경로들: Board/*, boards/* (대소문자 모두)
      for (const root of LEGACY_ROOTS) {
        await readNotesFromRoot(root, userId, noteMap);
      }

      const notes = Array.from(noteMap.values());
      notes.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      return res.status(200).json({ ok: true, notes, total: notes.length });
    }

    // ── 저장/수정 (표준 경로에만 저장) ──
    if (action === "save") {
      const { id, title, body } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });
      const now = new Date().toISOString();
      const existing = await readJsonFromDrive({ folderPath: notesPath, fileName: id }).catch(() => null);
      const data = {
        id,
        userId,
        title: String(title || "").trim() || "제목 없음",
        body: String(body || ""),
        category: "노트",
        createdAt: existing?.data?.createdAt || now,
        updatedAt: now,
        deleted: false
      };
      await saveJsonToDrive({ folderPath: notesPath, fileName: id, data });
      return res.status(200).json({ ok: true, note: data });
    }

    // ── 삭제 (모든 경로에서 soft delete) ──
    if (action === "delete") {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });

      // 표준 경로
      const ex = await readJsonFromDrive({ folderPath: notesPath, fileName: id }).catch(() => null);
      if (ex?.data) {
        await saveJsonToDrive({ folderPath: notesPath, fileName: id, data: { ...ex.data, deleted: true, deletedAt: new Date().toISOString() } });
      }

      // 레거시 경로들에서도 찾아서 soft delete
      for (const root of LEGACY_ROOTS) {
        // {root}/{userId}/{category}/
        try {
          const userRoot = await ensurePath([root, userId]).catch(() => null);
          if (userRoot?.id) {
            const catList = await listDriveDirectory({ folderId: userRoot.id, pageSize: 100 });
            const cats = (catList.files || []).filter(f => f.isFolder).map(f => f.name);
            const targets = cats.length ? cats.map(c => [root, userId, c]) : [[root, userId]];
            for (const fp of targets) {
              const e2 = await readJsonFromDrive({ folderPath: fp, fileName: id }).catch(() => null);
              if (e2?.data) await saveJsonToDrive({ folderPath: fp, fileName: id, data: { ...e2.data, deleted: true, deletedAt: new Date().toISOString() } });
            }
          }
        } catch(e) {}
        // {root}/{category}/
        try {
          const rootFolder = await ensurePath([root]).catch(() => null);
          if (rootFolder?.id) {
            const catList = await listDriveDirectory({ folderId: rootFolder.id, pageSize: 100 });
            const cats = (catList.files || []).filter(f => f.isFolder && f.name !== userId).map(f => f.name);
            for (const cat of cats) {
              const e3 = await readJsonFromDrive({ folderPath: [root, cat], fileName: id }).catch(() => null);
              if (e3?.data) await saveJsonToDrive({ folderPath: [root, cat], fileName: id, data: { ...e3.data, deleted: true, deletedAt: new Date().toISOString() } });
            }
          }
        } catch(e) {}
      }

      return res.status(200).json({ ok: true, message: "삭제됨" });
    }

    return res.status(400).json({ ok: false, message: "Unknown action: " + action });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
