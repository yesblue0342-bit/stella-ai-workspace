import crypto from "crypto";
import { getPool, sql } from "../../lib/db.js";

function clean(value) {
  return String(value || "").trim();
}

function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash) return false;
  const stored = String(storedPasswordHash);

  // New DB password format: salt:hash
  if (stored.includes(":")) {
    const [salt, originalHash] = stored.split(":");
    const inputHash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
    return inputHash === originalHash;
  }

  // Legacy localStorage style fallback used by old Stella builds.
  try {
    const legacy = Buffer.from(unescape(encodeURIComponent(String(password))), "binary").toString("base64");
    if (legacy === stored) return true;
  } catch {}

  return String(password) === stored;
}

async function ensureUsersTable(pool) {
  await pool.request().query(`
IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id NVARCHAR(100) NULL,
    email NVARCHAR(255) NULL,
    password_hash NVARCHAR(255) NULL,
    name NVARCHAR(100) NULL,
    birth NVARCHAR(30) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
IF COL_LENGTH('dbo.users', 'user_id') IS NULL
  ALTER TABLE dbo.users ADD user_id NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users', 'email') IS NULL
  ALTER TABLE dbo.users ADD email NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users', 'password_hash') IS NULL
  ALTER TABLE dbo.users ADD password_hash NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users', 'name') IS NULL
  ALTER TABLE dbo.users ADD name NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users', 'birth') IS NULL
  ALTER TABLE dbo.users ADD birth NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.users', 'created_at') IS NULL
  ALTER TABLE dbo.users ADD created_at DATETIME2 NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME();
  `);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const { email, id, user_id, username, password } = req.body || {};
    const loginId = clean(email || id || user_id || username).toLowerCase();
    const pw = String(password || "");

    if (!loginId || !pw) {
      return res.status(400).json({ ok: false, message: "아이디 또는 이메일과 비밀번호를 입력하세요." });
    }

    // ── ADMIN 하드코딩 우회 ──────────────────────────────
    if (loginId === "admin" && pw === "admin") {
      return res.status(200).json({
        ok: true,
        message: "로그인 성공",
        user: {
          id: "admin",
          db_id: 0,
          email: "admin@stella.local",
          name: "관리자",
          birth: "",
          role: "admin",
          created_at: new Date().toISOString()
        }
      });
    }
    // ────────────────────────────────────────────────────

    const pool = await getPool();
    await ensureUsersTable(pool);

    const result = await pool.request()
      .input("login_id", sql.NVarChar(255), loginId)
      .query(`
        SELECT TOP 1 id, user_id, email, password_hash, name, birth, created_at
        FROM dbo.users
        WHERE LOWER(ISNULL(email, '')) = @login_id
           OR LOWER(ISNULL(user_id, '')) = @login_id
           OR LOWER(ISNULL(name, '')) = @login_id
        ORDER BY id DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ ok: false, message: "가입 정보가 없습니다. 회원가입 후 같은 아이디/이메일로 로그인하세요." });
    }

    const user = result.recordset[0];
    const ok = verifyPassword(pw, user.password_hash);

    if (!ok) {
      return res.status(401).json({ ok: false, message: "비밀번호가 올바르지 않습니다." });
    }

    const outId = user.user_id || user.email || String(user.id);
    return res.status(200).json({
      ok: true,
      message: "로그인 성공",
      user: {
        id: outId,
        db_id: user.id,
        email: user.email || outId,
        name: user.name || user.email || outId,
        birth: user.birth || "",
        created_at: user.created_at
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "로그인 실패", error: error.message });
  }
}
