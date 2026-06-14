import crypto from "crypto";
import { getPool, sql } from "../lib/db.js";

function clean(v){ return String(v || "").trim(); }
async function ensure(pool){ await pool.request().query(`
IF OBJECT_ID('dbo.password_resets','U') IS NULL
BEGIN
 CREATE TABLE dbo.password_resets(id INT IDENTITY(1,1) PRIMARY KEY,user_id INT NOT NULL,token_hash NVARCHAR(128) NOT NULL,expires_at DATETIME2 NOT NULL,used_at DATETIME2 NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
END;
`); }
function hash(v){ return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function maskEmail(email){ const [a,b]=String(email||"").split("@"); if(!b) return ""; return `${a.slice(0,2)}***@${b}`; }
async function sendResetMail(email, link){
 const key=process.env.RESEND_API_KEY;
 const from=process.env.MAIL_FROM || "Stella <onboarding@resend.dev>";
 if(!key) return {sent:false, reason:"RESEND_API_KEY not configured", resetLink:link};
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({from,to:email,subject:"Stella 비밀번호 재설정",html:`<p>Stella 비밀번호 재설정 링크입니다.</p><p><a href="${link}">비밀번호 재설정</a></p><p>30분 후 만료됩니다.</p>`})});
 const data=await r.json().catch(()=>({}));
 return {sent:r.ok, provider:"resend", response:data};
}

export default async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({ok:false,message:"Method Not Allowed"});
 try{
  const loginId=clean((req.body||{}).email || (req.body||{}).id || (req.body||{}).user_id).toLowerCase();
  if(!loginId) return res.status(400).json({ok:false,message:"가입 이메일 또는 아이디를 입력하세요."});
  const pool=await getPool(); await ensure(pool);
  const found=await pool.request().input("id",sql.NVarChar(255),loginId).query(`SELECT TOP 1 id,user_id,email,name FROM dbo.users WHERE LOWER(ISNULL(email,''))=@id OR LOWER(ISNULL(user_id,''))=@id ORDER BY id DESC`);
  if(!found.recordset.length) return res.status(200).json({ok:true,message:"가입 정보가 있으면 재설정 메일을 보냈습니다."});
  const u=found.recordset[0]; const token=crypto.randomBytes(32).toString("hex");
  await pool.request().input("uid",sql.Int,u.id).input("th",sql.NVarChar(128),hash(token)).query(`INSERT INTO dbo.password_resets(user_id,token_hash,expires_at) VALUES(@uid,@th,DATEADD(minute,30,SYSUTCDATETIME()))`);
  const origin=(req.headers["x-forwarded-proto"]?`${req.headers["x-forwarded-proto"]}://${req.headers.host}`:`https://${req.headers.host}`);
  const link=`${origin}/reset?token=${encodeURIComponent(token)}&id=${encodeURIComponent(u.user_id||u.email)}`;
  const mail=await sendResetMail(u.email,link);
  return res.status(200).json({ok:true,message:mail.sent?`재설정 메일을 ${maskEmail(u.email)}로 보냈습니다.`:"재설정 링크가 생성되었습니다. 메일 API 설정 후 자동 전송됩니다.",mail});
 }catch(e){ return res.status(500).json({ok:false,message:"비밀번호 재설정 요청 실패",error:e.message}); }
}
