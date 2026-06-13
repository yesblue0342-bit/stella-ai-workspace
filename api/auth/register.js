import crypto from "crypto";
import { getPool, sql } from "../../lib/db.js";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    const { email, password, name } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: "이메일과 비밀번호를 입력하세요." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const displayName = name ? String(name).trim() : null;

    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({ message: "올바른 이메일 형식이 아닙니다." });
    }

    if (String(password).length < 4) {
      return res.status(400).json({ message: "비밀번호는 4자 이상 입력하세요." });
    }

    const passwordHash = hashPassword(String(password));
    const pool = await getPool();

    const exists = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .query("SELECT id FROM dbo.users WHERE email = @email");

    if (exists.recordset.length > 0) {
      return res.status(409).json({ message: "이미 가입된 이메일입니다." });
    }

    const result = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .input("name", sql.NVarChar(100), displayName)
      .query(`
        INSERT INTO dbo.users (email, password_hash, name)
        OUTPUT inserted.id, inserted.email, inserted.name, inserted.created_at
        VALUES (@email, @password_hash, @name)
      `);

    return res.status(201).json({
      message: "회원가입 성공",
      user: result.recordset[0]
    });
  } catch (error) {
    return res.status(500).json({
      message: "회원가입 실패",
      error: error.message
    });
  }
}
