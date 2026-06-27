// lib/session.js — 서버측 권한 스코프(세션 토큰) 단위 테스트.
// 순수 crypto HMAC(무상태) → DB(SQL Server/PostgreSQL) 비의존. jsdom/네트워크 불필요.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// 결정적 검증을 위해 비밀키 고정.
process.env.SESSION_SECRET = "unit-test-secret-0001";

// session.js 와 동일한 방식으로 토큰을 수동 서명(만료 토큰 등 경계 케이스 생성용).
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function craftToken(payload, secret = process.env.SESSION_SECRET) {
  const body = "v1." + b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return body + "." + sig;
}

const {
  issueToken, verifyToken, requireOwner, normId, extractToken, getAuthUser, COOKIE_NAME,
} = await import("../lib/session.js");

function mockRes() {
  return {
    statusCode: 0, headersSent: false, _json: null, _headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this._json = o; this.headersSent = true; return this; },
    setHeader(k, v) { this._headers[k] = v; },
    getHeader(k) { return this._headers[k]; },
    req: { headers: {} },
  };
}
function reqWithBearer(token) { return { headers: token ? { authorization: "Bearer " + token } : {} }; }
function reqWithCookie(token) { return { headers: { cookie: `${COOKIE_NAME}=${token}; other=1` } }; }

test("normId: trim + 소문자", () => {
  assert.equal(normId("  Yesblue0342 "), "yesblue0342");
  assert.equal(normId(null), "");
});

test("issue/verify 라운드트립 + uid 정규화", () => {
  const t = issueToken({ id: "Yesblue0342", name: "KH", email: "A@B.com", role: "user" });
  assert.equal(t.split(".").length, 3);
  const p = verifyToken(t);
  assert.ok(p);
  assert.equal(p.uid, "yesblue0342");
  assert.equal(p.email, "a@b.com");
  assert.equal(p.role, "user");
});

test("admin 역할 보존(isAdmin/role 둘 다)", () => {
  assert.equal(verifyToken(issueToken({ id: "a", isAdmin: true })).role, "admin");
  assert.equal(verifyToken(issueToken({ id: "a", role: "admin" })).role, "admin");
});

test("위조/손상 토큰 거부", () => {
  const t = issueToken({ id: "u1" });
  const parts = t.split(".");
  assert.equal(verifyToken(parts[0] + "." + parts[1] + "." + parts[2].slice(0, -2) + "zz"), null, "서명 변조");
  assert.equal(verifyToken(parts[0] + ".AAAA." + parts[2]), null, "페이로드 변조");
  assert.equal(verifyToken("garbage"), null);
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken(null), null);
});

test("다른 비밀키로 서명된 토큰은 거부(키 격리)", async () => {
  const t = issueToken({ id: "u1" });
  // 비밀키를 바꿔 새 모듈 인스턴스를 로드 → 같은 토큰이 검증 실패해야 함.
  process.env.SESSION_SECRET = "different-secret-9999";
  const mod2 = await import("../lib/session.js?bust=" + Date.now());
  assert.equal(mod2.verifyToken(t), null);
  process.env.SESSION_SECRET = "unit-test-secret-0001"; // 복구
});

test("만료 토큰 거부", () => {
  assert.ok(verifyToken(issueToken({ id: "u1" })), "방금 발급한 토큰은 유효");
  // 과거 exp 로 수동 서명한 토큰(서명은 정상, exp 만 지남) → 거부되어야.
  const past = Math.floor(Date.now() / 1000) - 100;
  const expired = craftToken({ uid: "u1", iat: past - 60, exp: past });
  assert.equal(verifyToken(expired), null, "만료 토큰은 거부");
  // 유효 exp + 정상 서명 → 통과(서명 검증 자체가 깨지지 않았음을 교차 확인)
  const future = Math.floor(Date.now() / 1000) + 1000;
  assert.ok(verifyToken(craftToken({ uid: "u1", iat: past, exp: future })), "유효 exp 는 통과");
});

test("extractToken: Bearer 우선, 쿠키 폴백", () => {
  const t = issueToken({ id: "u1" });
  assert.equal(extractToken(reqWithBearer(t)), t);
  assert.equal(extractToken(reqWithCookie(t)), t);
  assert.equal(extractToken({ headers: {} }), null);
});

test("requireOwner: 본인 일치 → uid 반환", () => {
  const t = issueToken({ id: "yesblue0342" });
  const res = mockRes();
  const r = requireOwner(reqWithBearer(t), res, "YesBlue0342");
  assert.ok(r);
  assert.equal(r.uid, "yesblue0342");
  assert.equal(res.statusCode, 0, "응답 미발생");
});

test("requireOwner: 타인 요청 → 403", () => {
  const t = issueToken({ id: "yesblue0342" });
  const res = mockRes();
  const r = requireOwner(reqWithBearer(t), res, "victim");
  assert.equal(r, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res._json.code, "FORBIDDEN_SCOPE");
});

test("requireOwner: 미인증 → 401", () => {
  const res = mockRes();
  const r = requireOwner({ headers: {} }, res, "yesblue0342");
  assert.equal(r, null);
  assert.equal(res.statusCode, 401);
  assert.equal(res._json.code, "AUTH_REQUIRED");
});

test("requireOwner soft: 미인증이면 요청 id 사용(비차단)", () => {
  const res = mockRes();
  const r = requireOwner({ headers: {} }, res, "Anyone", { soft: true });
  assert.ok(r);
  assert.equal(r.uid, "anyone");
  assert.equal(r.unauth, true);
  assert.equal(res.statusCode, 0);
});

test("requireOwner: 요청 id 비었으면 토큰 uid 사용", () => {
  const t = issueToken({ id: "yesblue0342" });
  const res = mockRes();
  const r = requireOwner(reqWithBearer(t), res, "");
  assert.equal(r.uid, "yesblue0342");
});

test("requireOwner: admin 은 타인 데이터 접근 허용(요청 id 로 스코프)", () => {
  const t = issueToken({ id: "admin", role: "admin" });
  const res = mockRes();
  const r = requireOwner(reqWithBearer(t), res, "victim");
  assert.ok(r);
  assert.equal(r.uid, "victim");
  assert.equal(r.role, "admin");
  assert.equal(res.statusCode, 0);
});

test("getAuthUser: 쿠키 경로로도 인증", () => {
  const t = issueToken({ id: "u1" });
  assert.equal(getAuthUser(reqWithCookie(t)).uid, "u1");
});
