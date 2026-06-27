import { getPool, sql, withRetry } from "../lib/db.js";
import { requireOwner } from "../lib/session.js";
function clean(v){return String(v||"").trim();}
export default async function handler(req,res){
  try{
    const requested=clean(req.query.userId||req.query.owner||req.query.email);
    // 서버측 권한 스코프: 인증 uid 의 채팅 인덱스만 조회.
    const auth=requireOwner(req,res,requested);
    if(!auth)return;
    const userId=auth.uid;
    if(!userId)return res.status(400).json({ok:false,message:"userId required"});
    // 콜드 스타트 대응: 연결+읽기 쿼리를 3회까지 재시도 (서버리스 첫 호출 타임아웃 완화).
    const r=await withRetry(async ()=>{
      const pool=await getPool();
      // 새 DB(테이블 미생성)에서도 에러 없이: 없으면 생성 후 빈 목록 반환. (저장(hybrid-chat-save) ensure와 동일 정의)
      await pool.request().query(`IF OBJECT_ID('dbo.chat_index','U') IS NULL CREATE TABLE dbo.chat_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,room_id NVARCHAR(100) NOT NULL,title NVARCHAR(255) NULL,project_id NVARCHAR(100) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,message_count INT NOT NULL DEFAULT 0,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`);
      return pool.request().input("user_id",sql.NVarChar(100),userId).query(`SELECT room_id,title,project_id,drive_file_id,drive_link,message_count,created_at,updated_at FROM dbo.chat_index WHERE user_id=@user_id ORDER BY updated_at DESC`);
    },{retries:3,baseDelay:400});
    return res.status(200).json({ok:true,items:r.recordset});
  }catch(e){
    return res.status(500).json({ok:false,message:"채팅 인덱스 조회 실패",error:e.message});
  }
}
