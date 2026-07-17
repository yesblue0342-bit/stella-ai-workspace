import { getPool, sql } from "../lib/db.js";
import { saveJsonToDrive } from "../lib/drive-utils.js";
import { requireOwner } from "../lib/session.js";
import { userChatsPath, safeRoom, trashLegacyChat } from "../lib/chat/chat-drive.mjs";

function clean(v){return String(v||"").trim();}
function safeId(v,p='id'){return (clean(v)||`${p}_${Date.now()}`).replace(/[^a-zA-Z0-9가-힣_-]/g,"_").slice(0,100);}
async function ensure(pool){await pool.request().query(`IF OBJECT_ID('dbo.chat_index','U') IS NULL CREATE TABLE dbo.chat_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,room_id NVARCHAR(100) NOT NULL,title NVARCHAR(255) NULL,project_id NVARCHAR(100) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,message_count INT NOT NULL DEFAULT 0,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`)}

export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({ok:false,message:"Method Not Allowed"});
 try{
  const b=req.body||{};
  // 서버측 권한 스코프: 인증 uid 의 채팅만 저장. user_id 는 토큰에서 도출(클라가 보낸 값 신뢰 안 함).
  const auth=requireOwner(req,res,clean(b.userId||b.owner||b.email));
  if(!auth)return;
  const userId=auth.uid;const roomId=safeRoom(b.roomId||b.id,"room");const title=clean(b.title||b.name||"새 채팅");const projectId=clean(b.projectId||"");const messages=Array.isArray(b.messages)?b.messages:[];
  // 저장 위치: StellaGPT/users/{uid}/chats/{roomId}.json (프로필/설정과 같은 유저 폴더 하위). 폴더 없으면 ensurePath 가 생성.
  const saved=await saveJsonToDrive({folderPath:userChatsPath(userId),fileName:`${roomId}.json`,data:{type:"chat",userId,roomId,title,projectId,messages,updatedAt:new Date().toISOString()}});
  // 중복 방지: 레거시 위치(chatgpt/chats/{uid})에 같은 채팅이 남아 있으면 휴지통으로(베스트에포트).
  trashLegacyChat(userId,roomId).catch(()=>{});
  const pool=await getPool();await ensure(pool);
  await pool.request().input("user_id",sql.NVarChar(100),userId).input("room_id",sql.NVarChar(100),roomId).input("title",sql.NVarChar(255),title).input("project_id",sql.NVarChar(100),projectId||null).input("drive_file_id",sql.NVarChar(255),saved.id||null).input("drive_link",sql.NVarChar(1000),saved.webViewLink||null).input("cnt",sql.Int,messages.length).query(`IF EXISTS(SELECT 1 FROM dbo.chat_index WHERE user_id=@user_id AND room_id=@room_id) UPDATE dbo.chat_index SET title=@title,project_id=@project_id,drive_file_id=@drive_file_id,drive_link=@drive_link,message_count=@cnt,updated_at=SYSUTCDATETIME() WHERE user_id=@user_id AND room_id=@room_id ELSE INSERT INTO dbo.chat_index(user_id,room_id,title,project_id,drive_file_id,drive_link,message_count) VALUES(@user_id,@room_id,@title,@project_id,@drive_file_id,@drive_link,@cnt)`);
  return res.status(200).json({ok:true,message:"채팅 저장 완료",saved,index:{userId,roomId,title,projectId,messageCount:messages.length}});
 }catch(e){return res.status(500).json({ok:false,message:"채팅 저장 실패",error:e.message});}
}
