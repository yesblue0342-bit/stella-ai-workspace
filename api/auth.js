// Stella 통합 인증 API - Drive + Azure SQL 이중 저장(콜드스타트·토큰만료 내성)
// 회원정보는 Drive auth/users/{id}.json + Azure dbo.users(password_hash 포함)에 저장.
// 로그인: Drive 우선 → 없으면 Azure 폴백(둘 다 조회). 기존 계정 데이터는 절대 삭제하지 않음(ADD-only).
import crypto from "crypto";
import { saveJsonToDrive, readJsonFromDrive } from "../lib/drive-utils.js";
import { isAdmin, canLogin, loginDenialMessage, effectiveStatus, adminPasswordOk } from "../lib/approval.js";

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
  // status/approvedAt 포함: 클라이언트가 "승인됨" 알림을 1회 표시할 수 있도록 노출.
  return { id, email: u.email || id, name: u.name || id, birth: u.birth || "", created_at: u.created_at || new Date().toISOString(),
    status: effectiveStatus(u), approvedAt: u.approvedAt || null };
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

// 공유 스키마 보장 (password_hash 포함). 기존 테이블이면 누락 컬럼만 ALTER ADD (데이터 보존).
async function ensureUsersTable(pool, sql){
  await pool.request().query(`
    IF OBJECT_ID('dbo.users','U') IS NULL CREATE TABLE dbo.users(
      id INT IDENTITY(1,1) PRIMARY KEY,
      user_id NVARCHAR(100) NULL, email NVARCHAR(255) NULL, password_hash NVARCHAR(255) NULL,
      name NVARCHAR(100) NULL, birth NVARCHAR(30) NULL, status NVARCHAR(16) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NULL);
    IF COL_LENGTH('dbo.users','status') IS NULL ALTER TABLE dbo.users ADD status NVARCHAR(16) NULL;
    IF COL_LENGTH('dbo.users','password_hash') IS NULL ALTER TABLE dbo.users ADD password_hash NVARCHAR(255) NULL;`);
}

// Azure 영속 저장(upsert) — password_hash 포함. 가입/로그인 백필 공용. 실패 무시(가입은 Drive로 이미 성공).
async function indexToAzure(user){
  try{
    const { getPool, sql } = await import("../lib/db.js");
    const pool = await getPool();
    await ensureUsersTable(pool, sql);
    await pool.request()
      .input("uid", sql.NVarChar(100), user.user_id||user.id||"")
      .input("email", sql.NVarChar(255), user.email||"")
      .input("phash", sql.NVarChar(255), user.password_hash||null)
      .input("name", sql.NVarChar(100), user.name||"")
      .input("birth", sql.NVarChar(30), user.birth||null)
      .input("status", sql.NVarChar(16), user.status||"pending")
      .query(`
        IF EXISTS(SELECT 1 FROM dbo.users WHERE LOWER(ISNULL(user_id,''))=LOWER(@uid) OR (LEN(@email)>0 AND LOWER(ISNULL(email,''))=LOWER(@email)))
          UPDATE dbo.users SET
            email=CASE WHEN LEN(@email)>0 THEN @email ELSE email END,
            password_hash=CASE WHEN @phash IS NOT NULL THEN @phash ELSE password_hash END,
            name=CASE WHEN LEN(@name)>0 THEN @name ELSE name END,
            birth=ISNULL(@birth,birth), status=ISNULL(@status,status), updated_at=SYSUTCDATETIME()
          WHERE LOWER(ISNULL(user_id,''))=LOWER(@uid) OR (LEN(@email)>0 AND LOWER(ISNULL(email,''))=LOWER(@email));
        ELSE
          INSERT INTO dbo.users(user_id,email,password_hash,name,birth,status) VALUES(@uid,@email,@phash,@name,@birth,@status);`);
  }catch{}
}

// Azure 폴백 조회 — Drive를 못 읽을 때(토큰 만료 등) 로그인 복구용. password_hash 포함 레코드 반환.
async function readUserFromAzure(idKey, emailKey){
  try{
    const { getPool, sql } = await import("../lib/db.js");
    const pool = await getPool();
    await ensureUsersTable(pool, sql);
    const r = await pool.request()
      .input("uid", sql.NVarChar(100), idKey||"")
      .input("email", sql.NVarChar(255), emailKey||"")
      .query(`SELECT TOP 1 user_id,email,password_hash,name,birth,status,created_at FROM dbo.users
              WHERE LOWER(ISNULL(user_id,''))=LOWER(@uid) OR (LEN(@email)>0 AND LOWER(ISNULL(email,''))=LOWER(@email))`);
    const row = r.recordset && r.recordset[0];
    if(!row) return null;
    return {
      user_id: row.user_id, id: row.user_id, email: row.email || "",
      password_hash: row.password_hash || "", name: row.name || row.user_id,
      birth: row.birth || "", status: row.status || "approved",
      created_at: row.created_at || new Date().toISOString(), _from: "azure"
    };
  }catch{ return null; }
}

// Azure 인덱스의 승인 상태 갱신 (부가 기록, 실패 무시). 승인/거절 시 호출.
export async function updateAzureStatus(userId, email, status){
  try{
    const { getPool, sql } = await import("../lib/db.js");
    const pool = await getPool();
    await pool.request().query(`IF OBJECT_ID('dbo.users','U') IS NOT NULL AND COL_LENGTH('dbo.users','status') IS NULL ALTER TABLE dbo.users ADD status NVARCHAR(16) NULL;`);
    await pool.request()
      .input("uid", sql.NVarChar(100), userId||"")
      .input("email", sql.NVarChar(255), email||"")
      .input("status", sql.NVarChar(16), status)
      .query(`UPDATE dbo.users SET status=@status, updated_at=SYSUTCDATETIME() WHERE LOWER(ISNULL(user_id,''))=LOWER(@uid) OR (LEN(@email)>0 AND LOWER(ISNULL(email,''))=LOWER(@email))`);
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

    // admin/admin 무조건 통과 (관리자는 항상 승인 상태)
    if(lower(rawId) === "admin" && password === "admin"){
      return res.status(200).json({ ok:true, message:"관리자 로그인", user:{ id:"admin", email:"admin@stella.local", name:"관리자", birth:"", created_at:new Date().toISOString(), status:"approved", approvedAt:null } });
    }
    // 관리자(yesblue0342 등) + ADMIN_PASSWORD(env) 통과 — Drive/Azure 없이도 콜드스타트·토큰만료 내성.
    // env 미설정 시 이 경로는 건너뛰고 아래 Drive/Azure 레코드 검증으로 폴백.
    if(isAdmin(rawId) && adminPasswordOk(password)){
      return res.status(200).json({ ok:true, message:"관리자 로그인", user:{ id: rawId||"admin", email: email||"admin@stella.local", name: name||"관리자", birth:"", created_at:new Date().toISOString(), status:"approved", approvedAt:null } });
    }

    // ===== 로그인 =====
    if(mode === "login"){
      // Drive 우선 → 없으면(토큰 만료/콜드스타트) Azure SQL 폴백
      let u = await readUser(idKey, emailKey);
      let fromAzure = false;
      if(!u){ u = await readUserFromAzure(rawId, email); fromAzure = !!u; }
      if(!u) return res.status(401).json({ ok:false, message:"가입 정보가 없습니다. 회원가입 후 로그인하세요." });
      if(!verify(password, u.password_hash)) return res.status(401).json({ ok:false, message:"비밀번호가 올바르지 않습니다." });
      // 승인 상태 판정 (서버측에서만 신뢰) — 관리자/하위호환은 approval 로직이 처리
      if(!canLogin(u)){
        return res.status(403).json({ ok:false, status:u.status||"", message: loginDenialMessage(u) || "로그인할 수 없는 계정입니다." });
      }
      // 백필: Drive로 로그인 성공했는데 Azure에 비번해시 없으면 Azure에 영속화(다음 토큰만료 대비). 실패 무시.
      if(!fromAzure && u.password_hash){ indexToAzure(u).catch(()=>{}); }
      return res.status(200).json({ ok:true, message:"로그인 성공", user:publicUser(u) });
    }

    // ===== 회원가입 =====
    if(password.length < 4) return res.status(400).json({ ok:false, message:"비밀번호는 4자 이상 입력하세요." });

    // 중복 확인 (ID / e-mail 각각 키값으로 검사) — 비밀번호 무관 무조건 차단
    const dupById    = idKey    ? await readUser(idKey, "")    : null;
    const dupByEmail = emailKey ? await readUser("", emailKey) : null;
    if(dupById){
      return res.status(409).json({ ok:false, code:"DUPLICATE_ID", field:"id", message:"가입한 ID가 존재합니다. 다른 ID로 신청하세요." });
    }
    if(dupByEmail){
      return res.status(409).json({ ok:false, code:"DUPLICATE_EMAIL", field:"email", message:"가입한 e-mail이 존재합니다. 다른 ID로 신청하세요." });
    }

    // 신규 가입: status=pending 으로 저장 (관리자 승인 전 로그인 불가).
    // 단, 관리자 ID로 가입하면 approval 로직이 항상 approved 취급하므로 잠기지 않음.
    const nowIso = new Date().toISOString();
    const userData = {
      type:"stella_member",
      id: rawId || email,
      user_id: rawId || email,
      email: email || rawId,
      name, birth,
      password_hash: makeHash(password),
      status: "pending",
      requestedAt: nowIso,
      approvedAt: null,
      approvedBy: null,
      created_at: nowIso
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

    // 관리자 ID는 즉시 로그인 가능, 일반 사용자는 승인 대기
    if(isAdmin(rawId || email)){
      return res.status(201).json({ ok:true, pending:false, status:"approved", message:"회원가입 성공 (관리자 계정)", user:publicUser(userData) });
    }
    return res.status(201).json({
      ok:true, pending:true, status:"pending",
      message:"회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
      user:publicUser(userData)
    });
  }catch(e){
    return res.status(500).json({ ok:false, message:"인증 처리 실패", error:e.message });
  }
}
