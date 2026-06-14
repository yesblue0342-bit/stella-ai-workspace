import crypto from "crypto";
import { getPool, sql } from "../lib/db.js";

function clean(value) {
  return String(value || "").trim();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash) return false;
  const stored = String(storedPasswordHash);
  if (stored.includes(":")) {
    const [salt, originalHash] = stored.split(":");
    const inputHash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
    return inputHash === originalHash;
  }
  return String(password) === stored;
}

async function ensureUsersTable(pool) {
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
IF COL_LENGTH('dbo.users', 'user_id') IS NULL ALTER TABLE dbo.users ADD user_id NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users', 'email') IS NULL ALTER TABLE dbo.users ADD email NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users', 'password_hash') IS NULL ALTER TABLE dbo.users ADD password_hash NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users', 'name') IS NULL ALTER TABLE dbo.users ADD name NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users', 'birth') IS NULL ALTER TABLE dbo.users ADD birth NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.users', 'created_at') IS NULL ALTER TABLE dbo.users ADD created_at DATETIME2 NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME();
  `);
}

function userPayload(user) {
  const outId = user.user_id || user.email || String(user.id);
  return {
    id: outId,
    db_id: user.id,
    email: user.email || outId,
    name: user.name || outId,
    birth: user.birth || "",
    created_at: user.created_at
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const rawEmail = clean(body.email);
    const rawId = clean(body.id || body.user_id || body.username);
    const email = clean(rawEmail || (String(rawId).includes("@") ? rawId : "")).toLowerCase();
    const userId = clean(rawId || email).toLowerCase();
    const name = clean(body.name) || userId || email;
    const birth = clean(body.birth || body.birthdate);
    const password = String(body.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: "이메일과 비밀번호를 입력하세요." });
    }
    if (!email.includes("@")) {
      return res.status(400).json({ ok: false, message: "올바른 이메일 형식이 아닙니다." });
    }
    if (password.length < 4) {
      return res.status(400).json({ ok: false, message: "비밀번호는 4자 이상 입력하세요." });
    }

    const pool = await getPool();
    await ensureUsersTable(pool);

    const exists = await pool.request()
      .input("user_id", sql.NVarChar(100), userId)
      .input("email", sql.NVarChar(255), email)
      .query(`
        SELECT TOP 1 id, user_id, email, password_hash, name, birth, created_at
        FROM dbo.users
        WHERE LOWER(ISNULL(user_id, '')) = @user_id
           OR LOWER(ISNULL(email, '')) = @email
        ORDER BY id DESC
      `);

    if (exists.recordset.length > 0) {
      const existing = exists.recordset[0];
      if (verifyPassword(password, existing.password_hash)) {
        return res.status(200).json({ ok: true, message: "이미 가입된 계정입니다. 자동 로그인합니다.", user: userPayload(existing) });
      }
      return res.status(409).json({ ok: false, message: "이미 가입된 아이디 또는 이메일입니다. 로그인 탭에서 로그인하세요." });
    }

    const passwordHash = hashPassword(password);
    const result = await pool.request()
      .input("user_id", sql.NVarChar(100), userId)
      .input("email", sql.NVarChar(255), email)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .input("name", sql.NVarChar(100), name)
      .input("birth", sql.NVarChar(30), birth || null)
      .query(`
        INSERT INTO dbo.users (user_id, email, password_hash, name, birth)
        OUTPUT inserted.id, inserted.user_id, inserted.email, inserted.name, inserted.birth, inserted.created_at
        VALUES (@user_id, @email, @password_hash, @name, @birth)
      `);

    return res.status(201).json({ ok: true, message: "회원가입 성공", user: userPayload(result.recordset[0]) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "회원가입 실패", error: error.message, code: error.code || null });
  }
}
