import crypto from "crypto";
import { getPool, sql } from "../lib/db.js";

function clean(v){ return String(v || "").trim(); }
function makeHash(secret){ const salt=crypto.randomBytes(16).toString("hex"); const hash=crypto.pbkdf2Sync(String(secret),salt,100000,64,"sha512").toString("hex"); return `${salt}:${hash}`; }
function verify(secret, stored){ if(!stored) return false; const s=String(stored); if(s.includes(":")){ const [salt,hash]=s.split(":"); return crypto.pbkdf2Sync(String(secret),salt,100000,64,"sha512").toString("hex")===hash; } return String(secret)===s; }

async function ensure(pool){ await pool.request().query(`
IF OBJECT_ID('dbo.users','U') IS NULL
BEGIN
 CREATE TABLE dbo.users(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NULL,email NVARCHAR(255) NULL,password_hash NVARCHAR(255) NULL,name NVARCHAR(100) NULL,birth NVARCHAR(30) NULL,drive_user_folder_id NVARCHAR(255) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NULL);
END;
IF COL_LENGTH('dbo.users','user_id') IS NULL ALTER TABLE dbo.users ADD user_id NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users','email') IS NULL ALTER TABLE dbo.users ADD email NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users','password_hash') IS NULL ALTER TABLE dbo.users ADD password_hash NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users','name') IS NULL ALTER TABLE dbo.users ADD name NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users','birth') IS NULL ALTER TABLE dbo.users ADD birth NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.users','drive_user_folder_id') IS NULL ALTER TABLE dbo.users ADD drive_user_folder_id NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users','created_at') IS NULL ALTER TABLE dbo.users ADD created_at DATETIME2 NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME();
IF COL_LENGTH('dbo.users','updated_at') IS NULL ALTER TABLE dbo.users ADD updated_at DATETIME2 NULL;
`); }

function payload(u){ const id=u.user_id || u.email || String(u.id||""); return { id, db_id:u.id||null, email:u.email || id, name:u.name || id, birth:u.birth || "", drive_user_folder_id:u.drive_user_folder_id||null, created_at:u.created_at||new Date().toISOString() }; }

async function tryCreateDriveFolders(userId) {
  try {
    const { createStellaDriveFolders } = await import("./drive-init-folders.js");
    return await createStellaDriveFolders(userId);
  } catch { return []; }
}

// Drive 폴백: Azure SQL 불가 시 Google Drive auth/users 폴더에 회원정보 저장
async function driveFallbackSignup(userId, email, name, birth, password) {
  const { saveJsonToDrive, readJsonFromDrive } = await import("../lib/drive-utils.js");
  const safe = String(userId||email).toLowerCase().replace(/[^a-zA-Z0-9@._-]/g,"_").slice(0,120);
  // 중복 확인
  try {
    const existing = await readJsonFromDrive({ folderPath: ["auth","users"], fileName: safe });
    if (existing?.data) {
      if (verify(password, existing.data.password_hash)) {
        return { ok:true, dup:true, user: payload(existing.data) };
      }
      return { ok:false, dup:true };
    }
  } catch {}
  const data = { type:"stella_member", id:userId||email, user_id:userId||email, email:email||userId, name, birth, password_hash: makeHash(password), created_at:new Date().toISOString() };
  await saveJsonToDrive({ folderPath:["auth","users"], fileName: safe, data });
  tryCreateDriveFolders(userId||email).catch(()=>{});
  return { ok:true, dup:false, user: payload(data) };
}

export default async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({ok:false,message:"Method Not Allowed"});
 try{
  const b=req.body||{};
  const userId=clean(b.id || b.user_id || b.username).toLowerCase();
  const email=clean(b.email || (String(userId).includes("@")?userId:"")).toLowerCase();
  const name=clean(b.name) || userId || email;
  const birth=clean(b.birth || b.birthdate);
  const password=String(b.password || "");

  if(!userId && !email) return res.status(400).json({ok:false,message:"아이디 또는 이메일을 입력하세요."});
  if(!password || password.length<4) return res.status(400).json({ok:false,message:"비밀번호는 4자 이상 입력하세요."});
  if(userId === "admin" || email === "admin") return res.status(409).json({ok:false,message:"예약된 아이디입니다. 다른 아이디를 사용해주세요."});

  // 1) Azure SQL 시도
  let pool=null, dbError=null;
  try {
    pool = await getPool();
    await ensure(pool);
  } catch (e) {
    dbError = e.message;
  }

  // 2) DB 연결 실패 → Google Drive 폴백으로 회원가입 진행
  if (!pool) {
    try {
      const fb = await driveFallbackSignup(userId, email, name, birth, password);
      if (fb.ok && fb.dup) return res.status(200).json({ok:true,message:"이미 가입된 계정입니다. 자동 로그인합니다.",user:fb.user,store:"drive"});
      if (fb.ok) return res.status(201).json({ok:true,message:"회원가입 성공",user:fb.user,store:"drive"});
      return res.status(409).json({ok:false,message:"이미 가입된 아이디 또는 이메일입니다. 로그인 탭에서 로그인하세요."});
    } catch (fbErr) {
      return res.status(500).json({ok:false,message:"회원가입 실패 (DB·Drive 모두 불가)",error:`DB:${dbError} / Drive:${fbErr.message}`});
    }
  }

  // 3) DB 정상 → 중복 확인
  const found=await pool.request()
    .input("uid",sql.NVarChar(100),userId)
    .input("email",sql.NVarChar(255),email)
    .query(`SELECT TOP 1 id,user_id,email,password_hash,name,birth,drive_user_folder_id,created_at FROM dbo.users WHERE LOWER(ISNULL(user_id,''))=@uid OR LOWER(ISNULL(email,''))=@email ORDER BY id DESC`);

  if(found.recordset.length){
    const u=found.recordset[0];
    if(verify(password,u.password_hash)){
      tryCreateDriveFolders(u.user_id||u.email).catch(()=>{});
      return res.status(200).json({ok:true,message:"이미 가입된 계정입니다. 자동 로그인합니다.",user:payload(u)});
    }
    return res.status(409).json({ok:false,message:"이미 가입된 아이디 또는 이메일입니다. 로그인 탭에서 로그인하세요."});
  }

  // 4) DB INSERT
  let inserted;
  try {
    const result=await pool.request()
      .input("uid",sql.NVarChar(100),userId||email)
      .input("email",sql.NVarChar(255),email||userId)
      .input("ph",sql.NVarChar(255),makeHash(password))
      .input("name",sql.NVarChar(100),name)
      .input("birth",sql.NVarChar(30),birth||null)
      .query(`INSERT INTO dbo.users(user_id,email,password_hash,name,birth,updated_at) OUTPUT inserted.id,inserted.user_id,inserted.email,inserted.name,inserted.birth,inserted.drive_user_folder_id,inserted.created_at VALUES(@uid,@email,@ph,@name,@birth,SYSUTCDATETIME())`);
    inserted = result.recordset[0];
  } catch (insErr) {
    return res.status(500).json({ok:false,message:"회원 정보 저장 실패",error:insErr.message,code:insErr.code||"DB_INSERT"});
  }

  tryCreateDriveFolders(userId||email).catch(()=>{});
  return res.status(201).json({ok:true,message:"회원가입 성공",user:payload(inserted),store:"azure"});
 }catch(e){
   return res.status(500).json({ok:false,message:"회원가입 실패",error:e.message,code:e.code||null});
 }
}
