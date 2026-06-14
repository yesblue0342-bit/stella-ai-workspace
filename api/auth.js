// Stella 통합 인증 API - Google Drive 단독으로 완결 (Azure SQL 없이도 작동)
// 회원정보는 Drive auth/users/{id}.json 에 저장, Azure는 부가 인덱스만(실패 무시)
import crypto from "crypto";
import { saveJsonToDrive, readJsonFromDrive } from "../lib/drive-utils.js";

function clean(v){ return String(v || "").trim(); }
function lower(v){ return clean(v).toLowerCase(); }
function safeKey(v){ return lower(v).replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0,120) || "user"; }
function makeHash(secret){
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(secret), salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}
function verify(secret, stored){
  if(!stored) return false;
  const s = String(stored);
  if(s.includes(":")){
    const [salt, hash] = s.split(":");
    return crypto.pbkdf2Sync(String(secret), salt, 100000, 64, "sha512").toString("hex") === hash;
  }
  return String(secret) === s;
}
function publicUser(u){
  const id = u.user_id || u.id || u.email;
  return { id, email: u.email || id, name: u.name || id, birth: u.birth || "", created_at: u.created_at || new Date().toISOString() };
}

// Drive에서 사용자 읽기 (id 또는 email 키 둘 다 시도)
async function readUser(idKey, emailKey){
  for(const key of [idKey, emailKey].filter(Boolean)){
    try{
      const f = await readJsonFromDrive({ folderPath:["auth","users"], fileName: key });
      if(f?.data) return f.data;
    }catch{}
  }
  return null;
}

// Azure 인덱스 부가 기록 (실패 무시)
async function indexToAzure(user){
  try{
    const { getPool, sql } = await import("../lib/db.js");
    const pool = await getPool();
    await pool.request().query(`IF OBJECT_ID('dbo.users','U') IS NULL CREATE TABLE dbo.users(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NULL,email NVARCHAR(255) NULL,password_hash NVARCHAR(255) NULL,name NVARCHAR(100) NULL,birth NVARCHAR(30) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NULL)`);
    await pool.request()
      .input("uid", sql.NVarChar(100), user.user_id||user.id)
      .input("email", sql.NVarChar(255), user.email||"")
      .input("name", sql.NVarChar(100), user.name||"")
      .input("birth", sql.NVarChar(30), user.birth||null)
      .query(`IF NOT EXISTS(SELECT 1 FROM dbo.users WHERE LOWER(ISNULL(user_id,''))=LOWER(@uid) OR LOWER(ISNULL(email,''))=LOWER(@email)) INSERT INTO dbo.users(user_id,email,name,birth) VALUES(@uid,@email,@name,@birth)`);
  }catch{}
}

export default async function handler(req, res){
  if(req.method !== "POST") return res.status(405).json({ ok:false, message:"Method Not Allowed" });
  try{
    const b = req.body || {};
    const mode = clean(b.mode) || (req.url.includes("signup") ? "signup" : (req.url.includes("login") ? "login" : "login"));
    const rawId = clean(b.id || b.user_id || b.username || b.loginId);
    const idKey = safeKey(rawId);
    const email = lower(b.email || (rawId.includes("@") ? rawId : ""));
    const emailKey = email ? safeKey(email) : "";
    const name = clean(b.name) || rawId || email;
    const birth = clean(b.birth || b.birthdate);
    const password = String(b.password || b.code || "");

    if(!rawId && !email) return res.status(400).json({ ok:false, message:"아이디 또는 이메일을 입력하세요." });
    if(!password) return res.status(400).json({ ok:false, message:"비밀번호를 입력하세요." });

    // admin/admin 무조건 통과
    if(lower(rawId) === "admin" && password === "admin"){
      return res.status(200).json({ ok:true, message:"관리자 로그인", user:{ id:"admin", email:"admin@stella.local", name:"관리자", birth:"", created_at:new Date().toISOString() } });
    }

    // ===== 로그인 =====
    if(mode === "login"){
      const u = await readUser(idKey, emailKey);
      if(!u) return res.status(401).json({ ok:false, message:"가입 정보가 없습니다. 회원가입 후 로그인하세요." });
      if(!verify(password, u.password_hash)) return res.status(401).json({ ok:false, message:"비밀번호가 올바르지 않습니다." });
      return res.status(200).json({ ok:true, message:"로그인 성공", user:publicUser(u) });
    }

    // ===== 회원가입 =====
    if(password.length < 4) return res.status(400).json({ ok:false, message:"비밀번호는 4자 이상 입력하세요." });

    // 중복 확인
    const existing = await readUser(idKey, emailKey);
    if(existing){
      if(verify(password, existing.password_hash)){
        return res.status(200).json({ ok:true, message:"이미 가입된 계정입니다. 자동 로그인합니다.", user:publicUser(existing) });
      }
      return res.status(409).json({ ok:false, message:"이미 가입된 아이디 또는 이메일입니다. 로그인 탭에서 로그인하세요." });
    }

    // Drive에 저장 (핵심 - 이게 성공하면 가입 완료)
    const userData = {
      type:"stella_member",
      id: rawId || email,
      user_id: rawId || email,
      email: email || rawId,
      name, birth,
      password_hash: makeHash(password),
      created_at: new Date().toISOString()
    };
    try{
      await saveJsonToDrive({ folderPath:["auth","users"], fileName: idKey, data: userData });
      if(emailKey && emailKey !== idKey){
        await saveJsonToDrive({ folderPath:["auth","users"], fileName: emailKey, data: { ...userData, aliasOf: idKey } });
      }
    }catch(driveErr){
      return res.status(500).json({ ok:false, message:"회원가입 실패 (Google Drive 저장 오류). 환경변수를 확인하세요.", error: driveErr.message });
    }

    // Azure 인덱스는 부가 (실패해도 가입 성공)
    indexToAzure(userData).catch(()=>{});

    return res.status(201).json({ ok:true, message:"회원가입 성공", user:publicUser(userData) });
  }catch(e){
    return res.status(500).json({ ok:false, message:"인증 처리 실패", error:e.message });
  }
}
