import { listJsonFromDrive, readJsonFromDrive } from "../lib/drive-utils.js";

// 사용자 목록 인메모리 캐시 — 기존엔 검색 키 입력마다 auth/users 전체(최대 200명)를
// Drive에서 N+1 read → 느리고 쿼터 소모. 60초 캐시로 검색은 메모리 필터만 수행.
let _cache = { at: 0, users: [] };
let _loading = null;
const TTL_MS = 60 * 1000;

async function loadAllUsers() {
  if (Date.now() - _cache.at < TTL_MS) return _cache.users;
  if (_loading) return _loading;
  _loading = (async () => {
    const files = await listJsonFromDrive({ folderPath: ["auth", "users"], pageSize: 200 });
    const users = [];
    const CONCURRENCY = 5;
    const names = files.map((f) => f.name.replace(/\.json$/, "")).filter((n) => !n.includes("@"));
    for (let i = 0; i < names.length; i += CONCURRENCY) {
      await Promise.all(names.slice(i, i + CONCURRENCY).map(async (name) => {
        try {
          const f = await readJsonFromDrive({ folderPath: ["auth", "users"], fileName: name });
          if (!f?.data) return;
          const u = f.data;
          if (u.aliasOf) return; // alias 제외
          users.push({
            id: u.id || u.user_id,
            name: u.name || u.id,
            email: u.email || "",
            created_at: u.created_at || ""
          });
        } catch (e) { /* skip */ }
      }));
    }
    _cache = { at: Date.now(), users };
    return users;
  })();
  try { return await _loading; } finally { _loading = null; }
}

export default async function handler(req, res) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const all = await loadAllUsers();
    const users = q
      ? all.filter((u) => String(u.id || "").toLowerCase().includes(q) || String(u.name || "").toLowerCase().includes(q))
      : all;
    return res.status(200).json({ ok: true, users });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
