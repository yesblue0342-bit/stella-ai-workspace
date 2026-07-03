// Stella 통합 인증 API - Drive + Azure SQL 이중 저장(콜드스타트·토큰만료 내성)
// 회원정보는 Drive auth/users/{id}.json + Azure dbo.users(password_hash 포함)에 저장.
// 로그인: Drive 우선 → 없으면 Azure 폴백(둘 다 조회). 기존 계정 데이터는 절대 삭제하지 않음(ADD-only).
import crypto from "crypto";
import { saveJsonToDrive, readJsonFromDrive } from "../lib/drive-utils.js";
import { isAdmin, effectiveStatus, adminPasswordOk } from "../lib/approval.js";
import { isAllowlisted, allowlistUser } from "../lib/login-allow.js";
import { issueToken, setSessionCookie } from "../lib/session.js";

// 로그인/가입 성공 응답에 서명 세션 토큰을 실어 보낸다(+ httpOnly 쿠키).
// 클라는 token 을 저장해 데이터 호출 시 Authorization: Bearer 로 전송(동일출처는 쿠키로도 자동).
function withSession(res, status, payload){
  try{
    const token = issueToken(payload.user);
    setSessionCookie(res, token);
    return res.status(status).json({ ...payload, token });
  }catch(e){
    return res.status(status).json(payload);
  }
}

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
  const admin = isAdmin(id);
  // role/isAdmin 포함: 권한 판정은 클라이언트가 이 값을 직접 사용(Drive 권한 조회 없음).
  return { id, email: u.email || id, name: u.name || id, birth: u.birth || "", created_at: u.created_at || new Date().toISOString(),
    role: admin ? "admin" : "user", isAdmin: admin,
    status: effectiveStatus(u), approvedAt: u.approvedAt || null };
}

// Drive에서 사용자 읽기 (id 또는 email 키 둘 다 시도)
// 단순 로그인: 파일 없음이든 저장소 오류든 모두 null 반환(오류 조용히 무시). 503 없음.
async function readUser(idKey, emailKey){
  for(const key of [idKey, emailKey].filter(Boolean)){
    try{
      const f = await readJsonFromDrive({ folderPath:["auth","users"], fileName: key });
      if(f?.data) return f.data;
    }catch{}
  }
  return null;
}

// 회원가입 중복확인 전용 — 저장소 '오류'를 null(=중복 없음)로 삼키면 기존 계정 파일을
// 새 가입 데이터로 덮어써(password_hash 교체) 계정 탈취가 가능하다 → 오류는 그대로 throw(fail-closed).
async function readUserStrict(key){
  if(!key) return null;
  const f = await readJsonFromDrive({ folderPath:["auth","users"], fileName: key });
  return f?.data || null;
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

    // ★ 하드코딩 화이트리스트 — 비밀번호 무관(틀려도/비어도) 즉시 로그인 성공. Drive 조회/저장 호출 없음. ★
    //   (비밀번호 필수 검사보다 먼저 둔다 → 빈 비번도 통과)
    if(isAllowlisted(rawId) || isAllowlisted(email)){
      const who = isAllowlisted(rawId) ? rawId : email;
      return withSession(res, 200, { ok:true, message:"로그인 성공", user: allowlistUser(who) });
    }

    if(!password) return res.status(400).json({ ok:false, message:"비밀번호를 입력하세요." });

    // admin/admin 무조건 통과 (관리자는 항상 승인 상태)
    if(lower(rawId) === "admin" && password === "admin"){
      return withSession(res, 200, { ok:true, message:"관리자 로그인", user:{ id:"admin", email:"admin@stella.local", name:"관리자", birth:"", created_at:new Date().toISOString(), role:"admin", isAdmin:true, status:"approved", approvedAt:null } });
    }
    // 관리자 + ADMIN_PASSWORD(env) 통과 (env 설정 시에만, 선택)
    if(isAdmin(rawId) && adminPasswordOk(password)){
      return withSession(res, 200, { ok:true, message:"관리자 로그인", user:{ id: rawId||"admin", email: email||"admin@stella.local", name: name||"관리자", birth:"", created_at:new Date().toISOString(), role:"admin", isAdmin:true, status:"approved", approvedAt:null } });
    }

    // ===== 로그인 ===== (단순 로그인: 조회 → 비번 검증 → 성공. 승인 게이트/503 없음)
    if(mode === "login"){
      // Drive 우선 → 없으면 Azure SQL 폴백 (저장소 오류는 readUser가 조용히 null 반환)
      let u = await readUser(idKey, emailKey);
      if(!u){ u = await readUserFromAzure(rawId, email); }
      if(!u) return res.status(401).json({ ok:false, message:"가입 정보가 없습니다. 회원가입 후 로그인하세요." });
      if(!verify(password, u.password_hash)) return res.status(401).json({ ok:false, message:"비밀번호가 올바르지 않습니다." });
      return withSession(res, 200, { ok:true, message:"로그인 성공", user:publicUser(u) });
    }

    // ===== 회원가입 =====
    // 신규 가입 중단 — Drive 쓰기 없이 403. (allowlist 운영 체제로 전환)
    if(password.length < 4) return res.status(400).json({ ok:false, message:"비밀번호는 4자 이상 입력하세요." });

    // 중복 확인 (ID / e-mail 각각 키값으로 검사) — 비밀번호 무관 무조건 차단
    // fail-closed: 저장소 오류 시 가입을 진행하면 기존 계정을 덮어쓸 수 있으므로 503으로 중단.
    let dupById, dupByEmail;
    try{
      dupById    = await readUserStrict(idKey);
      dupByEmail = await readUserStrict(emailKey);
    }catch(dupErr){
      console.error("[auth] signup dup-check failed:", dupErr && dupErr.message); // 내부 로그만
      return res.status(503).json({ ok:false, message:"잠시 후 다시 시도해주세요." });
    }
    if(dupById){
      return res.status(409).json({ ok:false, code:"DUPLICATE_ID", field:"id", message:"가입한 ID가 존재합니다. 다른 ID로 신청하세요." });
    }
    if(dupByEmail){
      return res.status(409).json({ ok:false, code:"DUPLICATE_EMAIL", field:"email", message:"가입한 e-mail이 존재합니다. 다른 ID로 신청하세요." });
    }

    // 신규 가입: 즉시 승인(approved)으로 저장 — 관리자 승인 대기 없음(단순 가입).
    const nowIso = new Date().toISOString();
    const userData = {
      type:"stella_member",
      id: rawId || email,
      user_id: rawId || email,
      email: email || rawId,
      name, birth,
      password_hash: makeHash(password),
      status: "approved",
      requestedAt: nowIso,
      approvedAt: nowIso,
      approvedBy: null,
      created_at: nowIso
    };
    try{
      await saveJsonToDrive({ folderPath:["auth","users"], fileName: idKey, data: userData });
      if(emailKey && emailKey !== idKey){
        await saveJsonToDrive({ folderPath:["auth","users"], fileName: emailKey, data: { ...userData, aliasOf: idKey } });
      }
    }catch(driveErr){
      console.error("[auth] signup persist failed:", driveErr && driveErr.message); // 내부 로그만
      return res.status(500).json({ ok:false, message:"잠시 후 다시 시도해주세요." });
    }

    // Azure 인덱스는 부가 (실패해도 가입 성공)
    indexToAzure(userData).catch(()=>{});

    // 즉시 가입 완료 → 바로 로그인 가능 (승인 대기 없음)
    return withSession(res, 201, { ok:true, pending:false, status:"approved", message:"회원가입이 완료되었습니다. 로그인하세요.", user:publicUser(userData) });
  }catch(e){
    console.error("[auth] handler error:", e && e.message); // 내부 로그만 — 화면엔 일반 문구
    return res.status(500).json({ ok:false, message:"잠시 후 다시 시도해주세요." });
  }
}
