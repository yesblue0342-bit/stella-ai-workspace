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
