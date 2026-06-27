// lib/session.js — 무상태(stateless) HMAC 서명 세션 토큰.
//
// 목적: 서버측 권한 스코프. 기존 api/* 는 클라이언트가 보낸 userId/owner 를 그대로 신뢰해
//       다른 사용자의 채팅/노트에 접근 가능(IDOR). 로그인 시 서버가 서명한 토큰을 발급하고,
//       데이터 엔드포인트는 이 토큰에서 인증된 uid 를 도출해 "본인 것만" 접근하도록 강제한다.
//
// 설계 원칙:
//   · DB 비의존(SQL Server/PostgreSQL 무관). 순수 crypto HMAC 만 사용 → 메타DB 종류와 독립.
//   · 무상태: 토큰 자체에 {uid,...,iat,exp} 를 담고 HMAC-SHA256 으로 서명. 서버 저장소 불필요.
//   · 전달 2경로: Authorization: Bearer <token> (교차출처/명시) + httpOnly 쿠키 stella_session(동일출처 자동).
//
// 토큰 포맷: v1.<base64url(payloadJSON)>.<base64url(HMAC-SHA256(v1.<payloadB64>))>

import crypto from "crypto";

export const COOKIE_NAME = "stella_session";
const TOKEN_VERSION = "v1";
const DEFAULT_TTL_SEC = 30 * 24 * 60 * 60; // 30일

// 서명 비밀키 — 운영 환경변수 우선. 미설정 시에도 동작은 하도록 폴백(경고 1회).
let _warned = false;
function getSecret() {
  const s =
    process.env.SESSION_SECRET ||
    process.env.PROXY_SECRET ||
    process.env.STELLA_ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    "";
  if (s && String(s).trim()) return String(s).trim();
  if (!_warned) {
    _warned = true;
    console.warn("[session] SESSION_SECRET(또는 PROXY_SECRET/ADMIN_PASSWORD) 미설정 — 고정 폴백 사용. 운영에선 SESSION_SECRET 설정 권장.");
  }
  // 폴백(식별자, 비밀 아님): 토큰 기능 자체는 유지하되 보안 강도는 env 설정 시보다 낮음.
  return "stella-default-session-secret-set-SESSION_SECRET";
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64");
}
function sign(data) {
  return b64url(crypto.createHmac("sha256", getSecret()).update(data).digest());
}
// 타이밍 안전 비교(서명 위조 방지). 길이 불일치도 안전 처리.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

function nowSec() { return Math.floor(Date.now() / 1000); }

// uid 정규화 — 토큰/리소스 비교는 항상 동일 규칙으로(소문자+trim).
export function normId(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

// 로그인 성공 후 토큰 발급. user 는 {id|user_id|email, name, email, role|isAdmin} 형태.
export function issueToken(user, ttlSec = DEFAULT_TTL_SEC) {
  const uid = normId(user && (user.user_id || user.id || user.email));
  if (!uid) throw new Error("issueToken: uid 없음");
  const iat = nowSec();
  const payload = {
    uid,
    name: (user && user.name) || uid,
    email: normId(user && user.email) || uid,
    role: user && (user.role === "admin" || user.isAdmin === true) ? "admin" : "user",
    iat,
    exp: iat + Math.max(60, Number(ttlSec) || DEFAULT_TTL_SEC),
  };
  const body = `${TOKEN_VERSION}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${sign(body)}`;
}

// 토큰 검증 → payload 반환(유효) 또는 null(무효/만료/위조).
export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [ver, payloadB64, sig] = parts;
  if (ver !== TOKEN_VERSION) return null;
  const body = `${ver}.${payloadB64}`;
  if (!safeEqual(sig, sign(body))) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")); } catch { return null; }
  if (!payload || !payload.uid) return null;
  if (typeof payload.exp === "number" && payload.exp < nowSec()) return null;
  return payload;
}

// 요청에서 토큰 추출: Authorization: Bearer 우선, 없으면 stella_session 쿠키.
export function extractToken(req) {
  const auth = req && (req.headers?.authorization || req.headers?.Authorization);
  if (auth && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, "").trim();
    if (t) return t;
  }
  // cookie-parser 사용 시 req.cookies, 아니면 헤더 직접 파싱.
  if (req && req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const raw = req && req.headers && req.headers.cookie;
  if (raw) {
    for (const part of String(raw).split(";")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      if (part.slice(0, i).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

// 인증된 사용자 payload 반환(없으면 null).
export function getAuthUser(req) {
  return verifyToken(extractToken(req));
}

// 로그인 응답에 세션 쿠키 설정(httpOnly, SameSite=Lax, Path=/). https면 Secure.
export function setSessionCookie(res, token, ttlSec = DEFAULT_TTL_SEC) {
  try {
    const secure = isHttps(res);
    const attrs = [
      `${COOKIE_NAME}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.max(60, Number(ttlSec) || DEFAULT_TTL_SEC)}`,
    ];
    if (secure) attrs.push("Secure");
    appendCookie(res, attrs.join("; "));
  } catch (e) { /* 쿠키 설정 실패는 치명적 아님(Bearer 헤더로도 동작) */ }
}

export function clearSessionCookie(res) {
  try {
    appendCookie(res, `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  } catch (e) {}
}

function appendCookie(res, cookieStr) {
  const prev = res.getHeader && res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookieStr);
  else if (Array.isArray(prev)) res.setHeader("Set-Cookie", [...prev, cookieStr]);
  else res.setHeader("Set-Cookie", [prev, cookieStr]);
}

function isHttps(res) {
  const req = res && res.req;
  if (!req) return false;
  if (req.secure) return true;
  const xf = req.headers && (req.headers["x-forwarded-proto"] || req.headers["X-Forwarded-Proto"]);
  return String(xf || "").split(",")[0].trim().toLowerCase() === "https";
}

// ── 권한 스코프 강제 ──────────────────────────────────────────────
// 요청을 인증하고, requestedId(클라가 보낸 owner/userId)가 인증 uid 와 일치하는지 검증.
//   · 인증 없음          → 401 응답 후 null 반환 (호출부는 즉시 return).
//   · uid != requested   → 403 응답 후 null 반환 (단, admin 은 허용).
//   · 통과               → { uid, role, payload } 반환. 호출부는 uid 를 리소스 키로 사용.
// opts.soft=true 이면 미인증 시 401 대신 { uid: normId(requestedId), role:"user", unauth:true } 반환
//   (핵심 경로/AI 챗처럼 깨지면 안 되는 곳의 점진 적용용).
export function requireOwner(req, res, requestedId, opts = {}) {
  const payload = getAuthUser(req);
  const reqId = normId(requestedId);

  if (!payload) {
    if (opts.soft) return { uid: reqId, role: "user", unauth: true, payload: null };
    if (res && !res.headersSent) {
      res.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "로그인이 필요합니다. 다시 로그인해 주세요." });
    }
    return null;
  }

  if (payload.role === "admin") {
    // 관리자는 요청 대상이 있으면 그 대상으로, 없으면 본인으로 스코프.
    return { uid: reqId || payload.uid, role: "admin", payload };
  }

  if (reqId && reqId !== payload.uid) {
    if (res && !res.headersSent) {
      res.status(403).json({ ok: false, code: "FORBIDDEN_SCOPE", message: "본인 데이터만 접근할 수 있습니다." });
    }
    return null;
  }

  return { uid: payload.uid, role: payload.role || "user", payload };
}

export default {
  COOKIE_NAME, normId, issueToken, verifyToken, extractToken,
  getAuthUser, setSessionCookie, clearSessionCookie, requireOwner,
};
