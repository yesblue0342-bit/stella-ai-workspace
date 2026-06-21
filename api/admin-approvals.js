// Stella GPT 회원가입 승인 API (관리자 전용)
// 보안: 모든 호출에서 호출자가 ADMIN_IDS인지 + 비밀번호가 맞는지 서버측에서 검증.
//       클라이언트 단 체크만으로 통과시키지 않음 (봇이 직접 호출 방지).
//   GET  : pending user 목록 반환            (관리자 인증: x-admin-id / x-admin-password 헤더)
//   POST : 승인/거절 또는 목록                 (body: { action, adminId, adminPassword, targetId, status })
import crypto from "crypto";
import { readJsonFromDrive, saveJsonToDrive, listJsonFromDrive } from "../lib/drive-utils.js";
import { isAdmin, isValidTransition, effectiveStatus, adminPasswordOk } from "../lib/approval.js";

function clean(v){ return String(v || "").trim(); }
function lower(v){ return clean(v).toLowerCase(); }
function safeKey(v){ return lower(v).replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0,120) || "user"; }
function verify(secret, stored){
  if(!stored) return false;
  const s = String(stored);
  if(s.includes(":")){
    const [salt, hash] = s.split(":");
    return crypto.pbkdf2Sync(String(secret), salt, 100000, 64, "sha512").toString("hex") === hash;
  }
  return String(secret) === s;
}

// 저장소 오류(토큰/설정)는 null이 아니라 throw 로 구분 — "관리자 인증 실패" 오인 방지.
async function readUser(key){
  const f = await readJsonFromDrive({ folderPath:["auth","users"], fileName: key });
  return f?.data || null;
}

// ── 서버측 관리자 인증 (기존 인증 방식 재사용: id + password) ──
async function authenticateAdmin(adminId, adminPassword){
  const id = clean(adminId);
  if(!isAdmin(id)) return { ok:false, code:403, message:"관리자 권한이 없습니다." };
  // 하드코딩 admin/admin (기존 동작과 동일)
  if(lower(id) === "admin" && String(adminPassword) === "admin") return { ok:true, id };
  // ADMIN_PASSWORD(env) 통과 — Drive 없이도 콜드스타트·토큰만료 내성(env 미설정 시 건너뜀)
  if(adminPasswordOk(adminPassword)) return { ok:true, id };
  // Drive 레코드의 password_hash 로 검증 (회원가입을 통해 저장된 관리자 계정)
  let rec = null;
  try{ rec = await readUser(safeKey(id)); }
  catch(e){ return { ok:false, code:503, message:"인증 저장소(Google Drive) 연결 오류입니다. 환경변수(토큰/폴더ID)를 확인하거나 ADMIN_PASSWORD로 로그인하세요." }; }
  if(rec && verify(String(adminPassword || ""), rec.password_hash)) return { ok:true, id };
  return { ok:false, code:401, message:"관리자 인증에 실패했습니다." };
}

// pending 사용자 목록 (alias 파일 제외, 중복 제거)
async function listPending(){
  const files = await listJsonFromDrive({ folderPath:["auth","users"], pageSize: 200 });
  const out = [];
  const seen = new Set();
  for(const f of files){
    const fileName = String(f.name || "").replace(/\.json$/i, "");
    if(!fileName) continue;
    const data = await readUser(fileName);
    if(!data || data.aliasOf) continue;                 // alias(이메일 사본) 제외
    if(effectiveStatus(data) !== "pending") continue;   // 관리자/approved/rejected 제외
    const uid = String(data.user_id || data.id || fileName);
    if(seen.has(uid)) continue;
    seen.add(uid);
    out.push({
      id: uid,
      key: fileName,
      name: data.name || uid,
      email: data.email || "",
      requestedAt: data.requestedAt || data.created_at || null,
      status: data.status || "pending"
    });
  }
  out.sort((a,b)=> String(b.requestedAt||"").localeCompare(String(a.requestedAt||"")));
  return out;
}

// 승인/거절 처리 (정식 파일 + 이메일 alias 둘 다 갱신)
async function setStatus({ targetId, targetKey, status, adminId }){
  if(!isValidTransition(status)) return { ok:false, code:400, message:"status는 approved 또는 rejected 만 가능합니다." };
  const key = clean(targetKey) || safeKey(clean(targetId));
  if(!key) return { ok:false, code:400, message:"대상 id가 필요합니다." };
  const data = await readUser(key);
  if(!data) return { ok:false, code:404, message:"대상 사용자를 찾을 수 없습니다." };

  const nowIso = new Date().toISOString();
  const updated = {
    ...data,
    status,
    // approvedAt 은 승인 시에만 갱신(거절은 기존 값 유지). rejectedAt 으로 거절 시각 별도 기록.
    approvedAt: status === "approved" ? nowIso : (data.approvedAt || null),
    rejectedAt: status === "rejected" ? nowIso : (data.rejectedAt || null),
    approvedBy: adminId
  };
  await saveJsonToDrive({ folderPath:["auth","users"], fileName: key, data: updated });

  // Azure 인덱스에도 승인 상태 기록 (부가, 실패 무시) — pending/approved/rejected DB 저장 보강
  try{
    const { updateAzureStatus } = await import("./auth.js");
    updateAzureStatus(updated.user_id || updated.id || key, updated.email || "", status).catch(()=>{});
  }catch(_){}

  // 이메일 alias 파일도 동기화 (이메일로 로그인해도 승인 상태 반영)
  const emailKey = updated.email ? safeKey(updated.email) : "";
  if(emailKey && emailKey !== key){
    const alias = await readUser(emailKey);
    if(alias && alias.aliasOf){
      await saveJsonToDrive({ folderPath:["auth","users"], fileName: emailKey, data: { ...alias, status, approvedAt: nowIso, approvedBy: adminId } });
    }
  }
  return { ok:true, id: updated.user_id || updated.id || key, status };
}

export default async function handler(req, res){
  try{
    const method = req.method || "GET";

    // ── 목록 (GET) ──
    if(method === "GET"){
      const adminId = clean(req.headers["x-admin-id"] || (req.query && req.query.adminId));
      const adminPassword = req.headers["x-admin-password"] || (req.query && req.query.adminPassword) || "";
      const auth = await authenticateAdmin(adminId, adminPassword);
      if(!auth.ok) return res.status(auth.code).json({ ok:false, message:auth.message });
      const pending = await listPending();
      return res.status(200).json({ ok:true, pending });
    }

    if(method !== "POST") return res.status(405).json({ ok:false, message:"Method Not Allowed" });

    const b = req.body || {};
    const action = clean(b.action) || "list";
    const auth = await authenticateAdmin(b.adminId, b.adminPassword);
    if(!auth.ok) return res.status(auth.code).json({ ok:false, message:auth.message });

    if(action === "list"){
      const pending = await listPending();
      return res.status(200).json({ ok:true, pending });
    }

    if(action === "approve" || action === "reject"){
      const status = action === "approve" ? "approved" : "rejected";
      const result = await setStatus({ targetId: b.targetId || b.id, targetKey: b.key, status, adminId: auth.id });
      if(!result.ok) return res.status(result.code).json({ ok:false, message:result.message });
      return res.status(200).json({ ok:true, message: status === "approved" ? "승인되었습니다." : "거절되었습니다.", id: result.id, status: result.status });
    }

    return res.status(400).json({ ok:false, message:"알 수 없는 action 입니다." });
  }catch(e){
    return res.status(500).json({ ok:false, message:"승인 처리 실패", error:e.message });
  }
}
