// /api/memory.js - 메모리 노드 조회/수정/삭제 API
import { saveJsonToDrive, readJsonFromDrive } from "../lib/drive-utils.js";
import { requireOwner } from "../lib/session.js";

const MEMORY_FOLDER = ["memory"];

export default async function handler(req, res) {
  const action = String(req.query.action || req.body?.action || "get").trim();
  const requested = String(req.query.userId || req.body?.userId || "").trim();
  // 서버측 권한 스코프: 본인 메모리만 조회/수정/삭제.
  const auth = requireOwner(req, res, requested);
  if (!auth) return;
  const userId = auth.uid;

  try {
    // ── 메모리 조회 ──
    if (action === "get" || req.method === "GET") {
      const memory = await readJsonFromDrive({ folderPath: MEMORY_FOLDER, fileName: `${userId}_memory` })
        .catch(() => null);
      return res.status(200).json({ ok: true, memory: memory || { userId, facts:[], patterns:[], preferences:[], context:[] } });
    }

    // ── 항목 삭제 ──
    if (action === "delete" && req.method === "POST") {
      const { category, index } = req.body || {};
      const memory = await readJsonFromDrive({ folderPath: MEMORY_FOLDER, fileName: `${userId}_memory` }).catch(() => null);
      if (!memory) return res.status(404).json({ ok: false, message: "메모리 없음" });
      if (memory[category] && Array.isArray(memory[category])) {
        memory[category].splice(index, 1);
        await saveJsonToDrive({ folderPath: MEMORY_FOLDER, fileName: `${userId}_memory`, data: { ...memory, updatedAt: new Date().toISOString() } });
      }
      return res.status(200).json({ ok: true, memory });
    }

    // ── 항목 추가 (수동) ──
    if (action === "add" && req.method === "POST") {
      const { category, item } = req.body || {};
      const memory = await readJsonFromDrive({ folderPath: MEMORY_FOLDER, fileName: `${userId}_memory` })
        .catch(() => ({ userId, facts:[], patterns:[], preferences:[], context:[], updatedAt: null }));
      if (!memory[category]) memory[category] = [];
      if (!memory[category].includes(item)) memory[category].push(item);
      await saveJsonToDrive({ folderPath: MEMORY_FOLDER, fileName: `${userId}_memory`, data: { ...memory, updatedAt: new Date().toISOString() } });
      return res.status(200).json({ ok: true, memory });
    }

    // ── 전체 초기화 ──
    if (action === "clear" && req.method === "POST") {
      const empty = { userId, facts:[], patterns:[], preferences:[], context:[], updatedAt: new Date().toISOString() };
      await saveJsonToDrive({ folderPath: MEMORY_FOLDER, fileName: `${userId}_memory`, data: empty });
      return res.status(200).json({ ok: true, message: "메모리 초기화 완료", memory: empty });
    }

    return res.status(400).json({ ok: false, message: `알 수 없는 action: ${action}` });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
