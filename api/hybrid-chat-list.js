import { getPool, sql, withRetry } from "../lib/db.js";
function clean(v){return String(v||"").trim();}
export default async function handler(req,res){
  try{
    const userId=clean(req.query.userId||req.query.owner||req.query.email);
    if(!userId)return res.status(400).json({ok:false,message:"userId required"});
    // 콜드 스타트 대응: 연결+읽기 쿼리를 3회까지 재시도 (서버리스 첫 호출 타임아웃 완화).
    const r=await withRetry(async ()=>{
      const pool=await getPool();
      return pool.request().input("user_id",sql.NVarChar(100),userId).query(`SELECT room_id,title,project_id,drive_file_id,drive_link,message_count,created_at,updated_at FROM dbo.chat_index WHERE user_id=@user_id ORDER BY updated_at DESC`);
    },{retries:3,baseDelay:400});
    return res.status(200).json({ok:true,items:r.recordset});
  }catch(e){
    return res.status(500).json({ok:false,message:"채팅 인덱스 조회 실패",error:e.message});
  }
}
