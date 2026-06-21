// Stella GPT 회원가입 승인 로직 (서버/클라이언트 공유, 순수 함수 - 단위테스트 가능)
// 무작위 봇 가입 차단: 가입은 누구나 가능하지만 관리자 승인 전에는 로그인 불가.

// 관리자 ID (소문자 비교, 대소문자 무시). DB 상태와 무관하게 항상 approved 취급.
export const ADMIN_IDS = ["yesblue0342", "admin"];

export const VALID_STATUS = ["pending", "approved", "rejected"];

function norm(v) { return String(v == null ? "" : v).trim().toLowerCase(); }

// 관리자 여부 (대소문자 무시)
export function isAdmin(id) {
  const v = norm(id);
  if (!v) return false;
  return ADMIN_IDS.some(a => norm(a) === v);
}

// 관리자 비밀번호 env 검증 — Drive/Azure 없이도(콜드스타트·토큰만료 내성) 관리자 로그인 가능.
// Vercel 환경변수 ADMIN_PASSWORD(또는 STELLA_ADMIN_PASSWORD) 설정 시에만 동작. 미설정이면 false(기존 폴백 유지).
// process 미정의(브라우저) 환경에서도 안전.
export function adminPasswordOk(password) {
  const pw = String(password == null ? "" : password);
  if (!pw) return false;
  let env = "";
  try {
    if (typeof process !== "undefined" && process.env) {
      env = process.env.ADMIN_PASSWORD || process.env.STELLA_ADMIN_PASSWORD || "";
    }
  } catch (_) {}
  env = String(env).trim();
  return !!env && pw === env;
}

// ADMIN_PASSWORD(env) 설정 여부 — 부트스트랩 admin/admin 차단 판정용.
export function adminPasswordConfigured() {
  try {
    if (typeof process !== "undefined" && process.env) {
      return !!String(process.env.ADMIN_PASSWORD || process.env.STELLA_ADMIN_PASSWORD || "").trim();
    }
  } catch (_) {}
  return false;
}

// ── Drive 독립 로그인: 하드코딩 허용 ID(비밀 아님) + 비밀번호는 env STELLA_MEMBERS ──
// 허용 ID 목록은 소스에 둬도 무방(식별자일 뿐). 비밀번호 값은 절대 소스에 두지 않고 Vercel env에서만 조회.
export const ALLOWLIST = ["yesblue0342", "dmswn8712", "mjlee", "stellanight"];

// env STELLA_MEMBERS(JSON) 파싱. 파싱 실패/미설정이면 {}.
export function getMembersEnv() {
  try {
    if (typeof process !== "undefined" && process.env && process.env.STELLA_MEMBERS) {
      const o = JSON.parse(process.env.STELLA_MEMBERS);
      return (o && typeof o === "object") ? o : {};
    }
  } catch (_) {}
  return {};
}

// STELLA_MEMBERS에 항목이 1개 이상이면 true(설정됨).
export function membersConfigured() {
  return Object.keys(getMembersEnv()).length > 0;
}

// 허용 id 결정(대소문자 무시): rawId가 allowlist면 그 id, 아니면 email이 STELLA_MEMBERS 항목의 email과
// 일치하고 그 키가 allowlist면 그 키. 둘 다 아니면 null. (Drive 조회 없음)
export function resolveAllowedId(rawId, email) {
  const idn = norm(rawId);
  if (idn && ALLOWLIST.some(a => norm(a) === idn)) {
    return ALLOWLIST.find(a => norm(a) === idn);
  }
  const em = norm(email);
  if (em) {
    const members = getMembersEnv();
    for (const key of Object.keys(members)) {
      const v = members[key];
      const memEmail = (v && typeof v === "object") ? norm(v.email) : "";
      if (memEmail && memEmail === em && ALLOWLIST.some(a => norm(a) === norm(key))) {
        return ALLOWLIST.find(a => norm(a) === norm(key));
      }
    }
  }
  return null;
}

// 허용 id의 비밀번호(평문 또는 salt:hash) 추출. env 키는 대소문자 무시 매칭. 없으면 "".
export function getMemberPw(id) {
  const members = getMembersEnv();
  const want = norm(id);
  for (const key of Object.keys(members)) {
    if (norm(key) === want) {
      const v = members[key];
      if (typeof v === "string") return v;
      if (v && typeof v === "object") return String(v.pw || "");
      return "";
    }
  }
  return "";
}

// 허용 id의 메타(email/name) — publicUser 보강용. 없으면 {}.
export function getMemberMeta(id) {
  const members = getMembersEnv();
  const want = norm(id);
  for (const key of Object.keys(members)) {
    if (norm(key) === want) {
      const v = members[key];
      if (v && typeof v === "object") return { email: v.email || "", name: v.name || "" };
      return {};
    }
  }
  return {};
}

// user record에서 식별자 추출 (user_id > id > email 순)
export function userIdOf(user) {
  if (!user) return "";
  return String(user.user_id || user.id || user.email || "");
}

// 실효 상태 판정 (서버측 로그인 판정의 단일 근거)
// 1) 관리자는 DB 상태와 무관하게 항상 approved
// 2) 하위호환: status 필드가 없는 기존 user는 approved (기존 실사용자 잠김 방지)
// 3) 알 수 없는 status 값도 approved로 폴백 (잠김 방지 우선)
export function effectiveStatus(user) {
  if (!user) return "rejected";
  if (isAdmin(userIdOf(user))) return "approved";
  const s = user.status;
  if (s === undefined || s === null || s === "") return "approved";
  return VALID_STATUS.includes(s) ? s : "approved";
}

// 로그인 통과 가능 여부
export function canLogin(user) {
  return effectiveStatus(user) === "approved";
}

// 거부 사유 메시지 (pending / rejected). approved면 null.
export function loginDenialMessage(user) {
  const st = effectiveStatus(user);
  if (st === "pending") return "관리자 승인 대기 중입니다.";
  if (st === "rejected") return "가입이 거절되었습니다.";
  return null;
}

// 관리자가 지정 가능한 상태 전이 대상 검증 (approved / rejected 만 허용)
export function isValidTransition(target) {
  return target === "approved" || target === "rejected";
}

// 승인 후 사용자 알림(앱 내):
//  - effective status 가 approved 이고 approvedAt 이 있으며,
//  - 사용자가 마지막으로 본 approvedAt 과 다르면 → 환영 메시지(1회), 아니면 null.
//  관리자/하위호환(approvedAt 없음) 계정은 알림 없음(불필요한 환영 방지).
export function approvalNotice(user, lastSeenApprovedAt) {
  if (!user) return null;
  if (effectiveStatus(user) !== "approved") return null;
  const approvedAt = user.approvedAt || null;
  if (!approvedAt) return null;
  if (lastSeenApprovedAt && String(lastSeenApprovedAt) === String(approvedAt)) return null;
  return "가입이 승인되었습니다. 환영합니다!";
}
