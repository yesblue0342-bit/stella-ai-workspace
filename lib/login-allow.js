// 하드코딩 화이트리스트 로그인 (서버리스 api/* 전용 — 클라이언트 소스에 명단 미노출).
// 이 ID들은 비밀번호가 틀려도/비어 있어도 로그인 성공하며, 처리 시 Google Drive 조회/저장을 전혀 하지 않는다.
// 비밀값 아님(식별자). 새 비밀 추가 없음 — Drive 의존 제거가 목적.

export const ALLOWLIST = ["yesblue0342", "dmswn8712", "mjlee"];
const ADMIN_ALLOW = ["yesblue0342"]; // 이 ID만 admin 권한

function norm(v) { return String(v == null ? "" : v).trim().toLowerCase(); }

// 주어진 식별자가 화이트리스트인지 (대소문자 무시)
export function isAllowlisted(id) {
  const v = norm(id);
  return !!v && ALLOWLIST.includes(v);
}

// 화이트리스트 사용자 객체 — id=username 고정(난수 없음), role/isAdmin 부여. Drive 호출 없음.
export function allowlistUser(id) {
  const matched = norm(id);
  const admin = ADMIN_ALLOW.includes(matched);
  return {
    id: matched, user_id: matched, email: matched, name: matched, birth: "",
    role: admin ? "admin" : "user", isAdmin: admin,
    status: "approved", approvedAt: null,
    created_at: new Date().toISOString(),
  };
}

// 내부 구조 노출 금칙어 (사용자 화면 메시지에 절대 포함 금지)
const BANNED = /google\s*drive|drive|환경\s*변수|environment|process\.env|(^|[^a-z])env([^a-z]|$)|stack\s*trace|api[\s_-]?key|refresh[\s_-]?token|node_modules|\/auth\/|\.js:\d/i;
export function hasBannedTerm(s) { return BANNED.test(String(s == null ? "" : s)); }

// 사용자에게 보이는 에러를 항상 일반 문구로 매핑(내부 메시지/스택/경로 미노출). 금칙어 보장 제거.
export function toUserError(_err, fallback) {
  const msg = fallback || "잠시 후 다시 시도해주세요.";
  // 폴백에 실수로 금칙어가 들어가도 안전하게 일반 문구로 대체
  return hasBannedTerm(msg) ? "잠시 후 다시 시도해주세요." : msg;
}

export default { ALLOWLIST, isAllowlisted, allowlistUser, toUserError, hasBannedTerm };
