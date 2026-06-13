import crypto from "crypto";
import { getPool, sql } from "../../lib/db.js";

function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !storedPasswordHash.includes(":")) return false;

  const [salt, originalHash] = storedPasswordHash.split(":");
  const inputHash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");

  return inputHash === originalHash;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const { email, id, user_id, username, password } = req.body || {};
    const loginId = String(email || id || user_id || username || "").trim().toLowerCase();

    if (!loginId || !password) {
      return res.status(400).json({ ok: false, message: "아이디 또는 이메일과 비밀번호를 입력하세요." });
    }

    const pool = await getPool();

    await pool.request().query(`
IF COL_LENGTH('dbo.users', 'user_id') IS NULL
  ALTER TABLE dbo.users ADD user_id NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users', 'birth') IS NULL
  ALTER TABLE dbo.users ADD birth NVARCHAR(30) NULL;
    `);

    const result = await pool.request()
      .input("login_id", sql.NVarChar(255), loginId)
      .query(`
        SELECT TOP 1 id, user_id, email, password_hash, name, birth, created_at
        FROM dbo.users
        WHERE LOWER(ISNULL(email, '')) = @login_id
           OR LOWER(ISNULL(user_id, '')) = @login_id
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ ok: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    const user = result.recordset[0];
    const ok = verifyPassword(password, user.password_hash);

    if (!ok) {
      return res.status(401).json({ ok: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    return res.status(200).json({
      ok: true,
      message: "로그인 성공",
      user: {
        id: user.user_id || String(user.id),
        db_id: user.id,
        email: user.email,
        name: user.name || user.email,
        birth: user.birth,
        created_at: user.created_at
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "로그인 실패", error: error.message });
  }
}
