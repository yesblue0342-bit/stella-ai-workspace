import crypto from "crypto";
import { getPool, sql } from "../lib/db.js";

function clean(v){ return String(v || "").trim(); }
function makeHash(secret){ const salt=crypto.randomBytes(16).toString("hex"); const hash=crypto.pbkdf2Sync(String(secret),salt,100000,64,"sha512").toString("hex"); return `${salt}:${hash}`; }
function verify(secret, stored){ if(!stored) return false; const s=String(stored); if(s.includes(":")){ const [salt,hash]=s.split(":"); return crypto.pbkdf2Sync(String(secret),salt,100000,64,"sha512").toString("hex")===hash; } return String(secret)===s; }
async function ensure(pool){ await pool.request().query(`
IF OBJECT_ID('dbo.users','U') IS NULL
BEGIN
 CREATE TABLE dbo.users(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NULL,email NVARCHAR(255) NULL,password_hash NVARCHAR(255) NULL,name NVARCHAR(100) NULL,birth NVARCHAR(30) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NULL);
END;
IF COL_LENGTH('dbo.users','user_id') IS NULL ALTER TABLE dbo.users ADD user_id NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users','email') IS NULL ALTER TABLE dbo.users ADD email NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users','password_hash') IS NULL ALTER TABLE dbo.users ADD password_hash NVARCHAR(255) NULL;
IF COL_LENGTH('dbo.users','name') IS NULL ALTER TABLE dbo.users ADD name NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.users','birth') IS NULL ALTER TABLE dbo.users ADD birth NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.users','created_at') IS NULL ALTER TABLE dbo.users ADD created_at DATETIME2 NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME();
IF COL_LENGTH('dbo.users','updated_at') IS NULL ALTER TABLE dbo.users ADD updated_at DATETIME2 NULL;
`); }
function payload(u){ const id=u.user_id || u.email || String(u.id); return { id, db_id:u.id, email:u.email || id, name:u.name || id, birth:u.birth || "", created_at:u.created_at }; }

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
  const pool=await getPool(); await ensure(pool);
  const found=await pool.request().input("uid",sql.NVarChar(100),userId).input("email",sql.NVarChar(255),email).query(`SELECT TOP 1 id,user_id,email,password_hash,name,birth,created_at FROM dbo.users WHERE LOWER(ISNULL(user_id,''))=@uid OR LOWER(ISNULL(email,''))=@email ORDER BY id DESC`);
  if(found.recordset.length){ const u=found.recordset[0]; if(verify(password,u.password_hash)) return res.status(200).json({ok:true,message:"이미 가입된 계정입니다. 자동 로그인합니다.",user:payload(u)}); return res.status(409).json({ok:false,message:"이미 가입된 아이디 또는 이메일입니다. 로그인 탭에서 로그인하세요."}); }
  const result=await pool.request().input("uid",sql.NVarChar(100),userId||email).input("email",sql.NVarChar(255),email||userId).input("ph",sql.NVarChar(255),makeHash(password)).input("name",sql.NVarChar(100),name).input("birth",sql.NVarChar(30),birth||null).query(`INSERT INTO dbo.users(user_id,email,password_hash,name,birth,updated_at) OUTPUT inserted.id,inserted.user_id,inserted.email,inserted.name,inserted.birth,inserted.created_at VALUES(@uid,@email,@ph,@name,@birth,SYSUTCDATETIME())`);
  return res.status(201).json({ok:true,message:"회원가입 성공",user:payload(result.recordset[0])});
 }catch(e){ return res.status(500).json({ok:false,message:"회원가입 실패",error:e.message,code:e.code||null}); }
}
