import crypto from "crypto";
import { getPool, sql } from "../../lib/db.js";

function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !storedPasswordHash.includes(":")) return false;

  const [salt, originalHash] = storedPasswordHash.split(":");
  const inputHash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");

  return crypto.timingSafeEqual(Buffer.from(inputHash, "hex"), Buffer.from(originalHash, "hex"));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: "이메일과 비밀번호를 입력하세요." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const pool = await getPool();

    const result = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .query(`
        SELECT id, email, password_hash, name, created_at
        FROM dbo.users
        WHERE email = @email
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const user = result.recordset[0];
    const ok = verifyPassword(password, user.password_hash);

    if (!ok) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    delete user.password_hash;

    return res.status(200).json({
      message: "로그인 성공",
      user
    });
  } catch (error) {
    return res.status(500).json({
      message: "로그인 실패",
      error: error.message
    });
  }
}
