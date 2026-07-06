import { saveJsonToDrive, listJsonFromDrive, readJsonFromDrive, listDriveDirectory, ensurePath, getNotesFolderId } from "../lib/drive-utils.js";
import { requireOwner } from "../lib/session.js";
// 노트가 저장될 수 있는 모든 레거시 루트 폴더명
// "Board"(대문자, 구버전 board-save), "boards"(소문자) 모두 탐색
const LEGACY_ROOTS = ["Board", "boards"];

// ★ 노트 고정 폴더 — 로그인 계정(uid)에 상관없이 항상 이 한 폴더로만 저장/조회한다.
//   사고: 로그인 방식마다 uid 가 달라져 users/<uid>/notes 가 여러 개로 흩어졌고
//   (실사: users/yesblue0342/notes, users/stellanight/notes …), 로그인마다 "노트를 못 읽는"
//   원인이 됐다. → 단일 폴더로 고정해 흩어짐을 근본 차단한다.
const NOTES_FOLDER_ID = getNotesFolderId();

// folderRef({folderPath} 또는 {folderId}) 하위의 노트 JSON들을 noteMap 에 수집.
// 이미 noteMap 에 있는 id 는 덮어쓰지 않음(먼저 넣은 소스가 우선).
// errors: Drive 목록 조회 자체가 실패(연결 불가/429/토큰)하면 여기 push → 호출부가
//         "빈 계정"과 "저장소 장애"를 구분할 수 있게 한다.
async function collectNotes(folderRef, noteMap, filterUserId = null, errors = null) {
  try {
    const files = await listJsonFromDrive({ ...folderRef, pageSize: 100 });
    // 병렬 처리 (최대 10개씩 배치) - 타임아웃 방지
    const BATCH = 10;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async function(f) {
        try {
          const fileName = f.name.replace(/\.json$/, "");
          const r = await readJsonFromDrive({ ...folderRef, fileName });
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
            deleted: false,
            _source: folderRef.folderId === NOTES_FOLDER_ID ? "pinned" : "scattered"
          });
        }
      }
    }
  } catch(e) { if (errors) errors.push(String(e?.message || e)); }
}

// users/ 하위의 모든 uid 폴더에서 notes 서브폴더를 찾아 수집(로그인 uid 변동으로 흩어진 노트 회수).
// 고정 폴더(NOTES_FOLDER_ID)는 이미 별도로 읽으므로 여기서 중복 수집돼도 noteMap 이 우선순위로 걸러낸다.
async function sweepScatteredUserNotes(noteMap) {
  try {
    const usersRoot = await ensurePath(["users"]).catch(() => null);
    if (!usersRoot?.id) return;
    const uidList = await listDriveDirectory({ folderId: usersRoot.id, pageSize: 100 });
    const uidFolders = (uidList.files || []).filter(f => f.isFolder);
    for (const uf of uidFolders) {
      try {
        const sub = await listDriveDirectory({ folderId: uf.id, pageSize: 100 });
        const notesFolder = (sub.files || []).find(f => f.isFolder && f.name === "notes");
        if (notesFolder?.id && notesFolder.id !== NOTES_FOLDER_ID) {
          await collectNotes({ folderId: notesFolder.id }, noteMap);
        }
      } catch(e) {}
    }
  } catch(e) {}
}

// 특정 레거시 루트 폴더(Board/boards) 하위의 모든 카테고리에서 노트 JSON 읽기
async function readNotesFromLegacyRoot(rootName, userId, noteMap) {
  try {
    // 구조1: {root}/{userId}/{category}/*.json
    const userRoot = await ensurePath([rootName, userId]).catch(() => null);
    if (userRoot?.id) {
      const catList = await listDriveDirectory({ folderId: userRoot.id, pageSize: 100 });
      const categories = (catList.files || []).filter(f => f.isFolder).map(f => f.name);
      const targets = categories.length ? categories.map(c => [rootName, userId, c]) : [[rootName, userId]];
      for (const fp of targets) {
        await collectNotes({ folderPath: fp }, noteMap);
      }
    }
  } catch(e) {}

  try {
    // 구조2: {root}/{category}/*.json  (userId 폴더 없이 카테고리 바로)
    const root = await ensurePath([rootName]).catch(() => null);
    if (root?.id) {
      const catList = await listDriveDirectory({ folderId: root.id, pageSize: 100 });
      const categories = (catList.files || []).filter(f => f.isFolder).map(f => f.name);
      for (const cat of categories) {
        if (cat === userId) continue;
        await collectNotes({ folderPath: [rootName, cat] }, noteMap, userId);
      }
    }
  } catch(e) {}
}

// 흩어진 폴더에서 발견된(고정 폴더에 없던) 노트를 고정 폴더로 이관(consolidate).
// 베스트에포트 — 실패해도 조회 응답에는 영향 없음.
async function migrateToPinned(note, userId) {
  try {
    const now = new Date().toISOString();
    await saveJsonToDrive({
      folderId: NOTES_FOLDER_ID,
      fileName: note.id,
      data: {
        id: note.id,
        userId: note.userId || userId,
        title: note.title || "제목 없음",
        body: note.body || "",
        category: note.category || "노트",
        createdAt: note.createdAt || now,
        updatedAt: note.updatedAt || note.createdAt || now,
        deleted: false
      }
    });
  } catch(e) {}
}

export default async function handler(req, res) {
  const action = String(req.query.action || req.body?.action || "list").trim();
  const requested = String(req.query.userId || req.body?.userId || "").trim();
  // 서버측 권한 스코프: 로그인 필요. 단, 노트 저장소는 로그인 uid 와 무관하게 고정 폴더 1개로 통일한다.
  const auth = requireOwner(req, res, requested);
  if (!auth) return;
  const userId = auth.uid;
  if (!userId) return res.status(400).json({ ok: false, message: "userId 필요" });

  try {
    // ── 목록 조회 (고정 폴더 우선 + 흩어진 users/*/notes + 레거시 Board/boards 통합) ──
    if (action === "list") {
      const noteMap = new Map();
      const errors = [];

      // 1) 고정 폴더: 항상 이 폴더가 진실의 원천(먼저 수집 → 우선순위 최상)
      await collectNotes({ folderId: NOTES_FOLDER_ID }, noteMap, null, errors);

      // 2) 흩어진 노트 회수: users/*/notes (로그인 uid 변동으로 생긴 형제 폴더들)
      await sweepScatteredUserNotes(noteMap);

      // 3) 레거시 경로들: Board/*, boards/* (대소문자 모두)
      for (const root of LEGACY_ROOTS) {
        await readNotesFromLegacyRoot(root, userId, noteMap);
      }

      // 저장소가 완전히 불통(고정 폴더 조회 실패)인데 결과가 0개면, "노트 없음"이 아니라
      // "장애"다 → 빈 목록을 정답처럼 반환해 사용자가 노트가 사라졌다고 오해하지 않게 503.
      if (noteMap.size === 0 && errors.length > 0) {
        console.error("[note:list] 저장소 조회 실패:", errors.join(" | "));
        return res.status(503).json({ ok: false, message: "노트 저장소를 읽지 못했습니다. 잠시 후 다시 시도해주세요." });
      }

      // 4) 고정 폴더 밖에서 발견된 노트는 고정 폴더로 이관(consolidate) — 다음 로그인부터 안 흩어짐
      const toMigrate = Array.from(noteMap.values()).filter(n => n._source !== "pinned");
      for (const n of toMigrate) {
        await migrateToPinned(n, userId);
      }

      const notes = Array.from(noteMap.values()).map(({ _source, ...n }) => n);
      notes.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      return res.status(200).json({ ok: true, notes, total: notes.length });
    }

    // ── 저장/수정 (고정 폴더에만 저장) ──
    if (action === "save") {
      const { id, title, body } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });
      const now = new Date().toISOString();
      const existing = await readJsonFromDrive({ folderId: NOTES_FOLDER_ID, fileName: id }).catch(() => null);
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
      await saveJsonToDrive({ folderId: NOTES_FOLDER_ID, fileName: id, data });
      return res.status(200).json({ ok: true, note: data });
    }

    // ── 삭제 (고정 폴더 + 흩어진/레거시 경로 모두 soft delete) ──
    if (action === "delete") {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: "note id 필요" });
      const nowDel = new Date().toISOString();

      // 고정 폴더
      const ex = await readJsonFromDrive({ folderId: NOTES_FOLDER_ID, fileName: id }).catch(() => null);
      if (ex?.data) {
        await saveJsonToDrive({ folderId: NOTES_FOLDER_ID, fileName: id, data: { ...ex.data, deleted: true, deletedAt: nowDel } });
      }

      // 흩어진 users/*/notes 에도 같은 노트가 있으면 soft delete
      try {
        const usersRoot = await ensurePath(["users"]).catch(() => null);
        if (usersRoot?.id) {
          const uidList = await listDriveDirectory({ folderId: usersRoot.id, pageSize: 100 });
          for (const uf of (uidList.files || []).filter(f => f.isFolder)) {
            try {
              const sub = await listDriveDirectory({ folderId: uf.id, pageSize: 100 });
              const nf = (sub.files || []).find(f => f.isFolder && f.name === "notes");
              if (nf?.id && nf.id !== NOTES_FOLDER_ID) {
                const e2 = await readJsonFromDrive({ folderId: nf.id, fileName: id }).catch(() => null);
                if (e2?.data) await saveJsonToDrive({ folderId: nf.id, fileName: id, data: { ...e2.data, deleted: true, deletedAt: nowDel } });
              }
            } catch(e) {}
          }
        }
      } catch(e) {}

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
              if (e2?.data) await saveJsonToDrive({ folderPath: fp, fileName: id, data: { ...e2.data, deleted: true, deletedAt: nowDel } });
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
              if (e3?.data) await saveJsonToDrive({ folderPath: [root, cat], fileName: id, data: { ...e3.data, deleted: true, deletedAt: nowDel } });
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
