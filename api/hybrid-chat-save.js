import { getPool, sql } from "../lib/db.js";
import { saveJsonToDrive } from "../lib/drive-utils.js";

function clean(v){return String(v||"").trim();}
function safeId(v,p='id'){return (clean(v)||`${p}_${Date.now()}`).replace(/[^a-zA-Z0-9가-힣_-]/g,"_").slice(0,100);}
async function ensure(pool){await pool.request().query(`IF OBJECT_ID('dbo.chat_index','U') IS NULL CREATE TABLE dbo.chat_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,room_id NVARCHAR(100) NOT NULL,title NVARCHAR(255) NULL,project_id NVARCHAR(100) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,message_count INT NOT NULL DEFAULT 0,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`)}

export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({ok:false,message:"Method Not Allowed"});
 try{
  const b=req.body||{};const userId=safeId(b.userId||b.owner||b.email,"user");const roomId=safeId(b.roomId||b.id,"room");const title=clean(b.title||b.name||"새 채팅");const projectId=clean(b.projectId||"");const messages=Array.isArray(b.messages)?b.messages:[];
  const saved=await saveJsonToDrive({folderPath:["chatgpt","chats",userId],fileName:`${roomId}.json`,data:{type:"chat",userId,roomId,title,projectId,messages,updatedAt:new Date().toISOString()}});
  const pool=await getPool();await ensure(pool);
  await pool.request().input("user_id",sql.NVarChar(100),userId).input("room_id",sql.NVarChar(100),roomId).input("title",sql.NVarChar(255),title).input("project_id",sql.NVarChar(100),projectId||null).input("drive_file_id",sql.NVarChar(255),saved.id||null).input("drive_link",sql.NVarChar(1000),saved.webViewLink||null).input("cnt",sql.Int,messages.length).query(`IF EXISTS(SELECT 1 FROM dbo.chat_index WHERE user_id=@user_id AND room_id=@room_id) UPDATE dbo.chat_index SET title=@title,project_id=@project_id,drive_file_id=@drive_file_id,drive_link=@drive_link,message_count=@cnt,updated_at=SYSUTCDATETIME() WHERE user_id=@user_id AND room_id=@room_id ELSE INSERT INTO dbo.chat_index(user_id,room_id,title,project_id,drive_file_id,drive_link,message_count) VALUES(@user_id,@room_id,@title,@project_id,@drive_file_id,@drive_link,@cnt)`);
  return res.status(200).json({ok:true,message:"채팅 저장 완료",saved,index:{userId,roomId,title,projectId,messageCount:messages.length}});
 }catch(e){return res.status(500).json({ok:false,message:"채팅 저장 실패",error:e.message});}
}
