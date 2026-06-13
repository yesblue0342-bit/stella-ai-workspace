import { createHash } from "crypto";
import { getPool, sql } from "../lib/db.js";

function hashPassword(password) {
  const secret = process.env.AUTH_SECRET || "stella-default-auth-secret";
  return createHash("sha256").update(`${password}:${secret}`).digest("hex");
}

function clean(value) {
  return String(value || "").trim();
}

async function ensureUsersColumns(pool) {
  await pool.request().query(`
IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id NVARCHAR(100) NULL,
    email NVARCHAR(255) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
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
  ALTER TABLE dbo.users ADD created_at DATETIME2 NOT NULL CONSTRAINT DF_users_created_at_login DEFAULT SYSUTCDATETIME();
  `);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST method only" });
  }

  try {
    const body = req.body || {};
    const loginId = clean(body.id || body.user_id || body.username || body.email).toLowerCase();
    const password = String(body.password || "");

    if (!loginId || !password) {
      return res.status(400).json({ ok: false, error: "아이디/이메일과 비밀번호를 입력해 주세요." });
    }

    const pool = await getPool();
    await ensureUsersColumns(pool);

    const passwordHash = hashPassword(password);
    const result = await pool.request()
      .input("login_id", sql.NVarChar(255), loginId)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .query(`
        SELECT TOP 1 id, user_id, email, name, birth, created_at
        FROM dbo.users
        WHERE (LOWER(ISNULL(user_id, '')) = @login_id OR LOWER(ISNULL(email, '')) = @login_id)
          AND password_hash = @password_hash
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ ok: false, error: "아이디 또는 비밀번호가 맞지 않습니다." });
    }

    const user = result.recordset[0];
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
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
