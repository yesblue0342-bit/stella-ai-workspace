import { listJsonFromDrive, readJsonFromDrive } from "../lib/drive-utils.js";

export default async function handler(req, res) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    // auth/users 폴더에서 전체 사용자 파일 목록 조회
    const files = await listJsonFromDrive({ folderPath: ["auth", "users"], pageSize: 200 });
    const users = [];
    for (const file of files) {
      try {
        const name = file.name.replace(/\.json$/, "");
        // alias 파일 제외 (@ 포함이거나 .id 접미사)
        if (name.includes("@")) continue;
        const f = await readJsonFromDrive({ folderPath: ["auth", "users"], fileName: name });
        if (!f?.data) continue;
        const u = f.data;
        if (u.aliasOf) continue; // alias 제외
        // 검색어 필터
        const uid = String(u.id || u.user_id || "").toLowerCase();
        const uname = String(u.name || "").toLowerCase();
        if (q && !uid.includes(q) && !uname.includes(q)) continue;
        users.push({
          id: u.id || u.user_id,
          name: u.name || u.id,
          email: u.email || "",
          created_at: u.created_at || ""
        });
      } catch(e) { /* skip */ }
    }
    return res.status(200).json({ ok: true, users });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
