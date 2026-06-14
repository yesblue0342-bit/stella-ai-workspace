import { ensurePath } from "../lib/drive-utils.js";

function clean(v){ return String(v||"").trim().replace(/[^a-zA-Z0-9가-힣_-]/g,"_").slice(0,100) || "default"; }

export async function createStellaDriveFolders(userId="default"){
  const uid=clean(userId);
  const paths=[
    ["users",uid,"profile"],["users",uid,"settings"],["users",uid,"avatar"],
    ["chatgpt","chats",uid],["chatgpt","archive",uid],["chatgpt","backups",uid],
    ["claude","chats",uid],["moyogpt","chats",uid],
    ["projects",uid],["boards",uid],["MemberChat"],
    ["uploads",uid,"pdf"],["uploads",uid,"excel"],["uploads",uid,"image"],["uploads",uid,"video"],["uploads",uid,"etc"],
    ["backups",uid],["apps","StellaGPT"],["apps","StellaTalk"],["apps","StellaCloud"]
  ];
  const made=[];
  for(const p of paths){ const f=await ensurePath(p); made.push({path:p.join("/"),id:f.id,name:f.name}); }
  return made;
}

export default async function handler(req,res){
 try{
  const userId=clean(req.query.userId || req.query.id || "default");
  const folders=await createStellaDriveFolders(userId);
  return res.status(200).json({ok:true,message:"Google Drive Stella 폴더 생성/확인 완료",userId,folders});
 }catch(e){return res.status(500).json({ok:false,message:"Google Drive 폴더 생성 실패",error:e.message});}
}
