import crypto from "crypto";
import { readJsonFromDrive, saveJsonToDrive, ensurePath } from "../lib/drive-utils.js";

const clean = (v) => String(v || "").trim();
const safe = (v) => clean(v).toLowerCase().replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 120) || "user";
const make = (v, salt) => crypto.pbkdf2Sync(String(v), salt, 120000, 64, "sha512").toString("hex");
const out = (u) => ({ id: u.id, email: u.email, name: u.name, birth: u.birth || "", created_at: u.created_at });

async function init(id) {
  const paths = [["auth", "users"], ["users", id, "profile"], ["users", id, "settings"], ["chatgpt", "chats", id], ["projects", id], ["boards", id], ["uploads", id, "pdf"], ["uploads", id, "excel"], ["uploads", id, "image"], ["uploads", id, "video"], ["backups", id], ["apps", "StellaGPT"], ["apps", "StellaTalk"], ["apps", "StellaCloud"]];
  for (const p of paths) await ensurePath(p);
}
async function read(id) {
  const file = await readJsonFromDrive({ folderPath: ["auth", "users"], fileName: safe(id) });
  return file?.data || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  try {
    const b = req.body || {};
    const mode = clean(b.mode || "login");
    const id = safe(b.id || b.email || b.user_id);
    const email = clean(b.email || id).toLowerCase();
    const code = String(b.code || b.credential || "");
    if (!id || !code) return res.status(400).json({ ok: false, message: "아이디와 인증값을 입력하세요." });
    if (mode === "signup") {
      const dupById = await read(id);
      if (dupById) return res.status(409).json({ ok:false, code:"DUPLICATE_ID", field:"id", message:"가입한 ID가 존재합니다. 다른 ID로 신청하세요." });
      const dupByEmail = (email && email !== id) ? await read(safe(email)) : null;
      if (dupByEmail) return res.status(409).json({ ok:false, code:"DUPLICATE_EMAIL", field:"email", message:"가입한 e-mail이 존재합니다. 다른 ID로 신청하세요." });
      await init(id);
      const salt = crypto.randomBytes(16).toString("hex");
      const data = { type: "stella_member", id, email, name: clean(b.name) || id, birth: clean(b.birth), salt, digest: make(code, salt), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await saveJsonToDrive({ folderPath: ["auth", "users"], fileName: id, data });
      if (email && email !== id) await saveJsonToDrive({ folderPath: ["auth", "users"], fileName: safe(email), data: { ...data, aliasOf: id } });
      return res.status(201).json({ ok: true, message: "회원가입 성공", user: out(data), source: "drive" });
    }
    const user = await read(id) || await read(email);
    if (!user) return res.status(401).json({ ok: false, message: "가입 정보가 없습니다." });
    if (make(code, user.salt) !== user.digest) return res.status(401).json({ ok: false, message: "인증값이 올바르지 않습니다." });
    return res.status(200).json({ ok: true, message: "로그인 성공", user: out(user), source: "drive" });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "처리 실패" });
  }
}
