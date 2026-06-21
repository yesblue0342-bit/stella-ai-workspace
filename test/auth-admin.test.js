// A1: 관리자 인증 핵심 경로 — ADMIN_PASSWORD(env)로 yesblue0342가 Drive/Azure 없이 통과하는지 실제 핸들러로 검증.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminPasswordOk, isAdmin, canLogin, effectiveStatus } from "../lib/approval.js";

function mockRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

test("adminPasswordOk: env 미설정이면 false", () => {
  delete process.env.ADMIN_PASSWORD; delete process.env.STELLA_ADMIN_PASSWORD;
  assert.equal(adminPasswordOk("anything"), false);
});

test("adminPasswordOk: ADMIN_PASSWORD 일치 시 true", () => {
  process.env.ADMIN_PASSWORD = "kh-secret-1234";
  assert.equal(adminPasswordOk("kh-secret-1234"), true);
  assert.equal(adminPasswordOk("wrong"), false);
  delete process.env.ADMIN_PASSWORD;
});

test("isAdmin: yesblue0342/admin은 관리자, 대소문자 무시", () => {
  assert.equal(isAdmin("yesblue0342"), true);
  assert.equal(isAdmin("YESBLUE0342"), true);
  assert.equal(isAdmin("admin"), true);
  assert.equal(isAdmin("guest"), false);
});

test("auth 핸들러: yesblue0342 + ADMIN_PASSWORD → 200 관리자 로그인 (Drive/Azure 불필요)", async () => {
  process.env.ADMIN_PASSWORD = "kh-secret-1234";
  const { default: handler } = await import("../api/auth.js");
  const res = mockRes();
  await handler({ method: "POST", url: "/api/login", body: { mode: "login", id: "yesblue0342", password: "kh-secret-1234" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.status, "approved");
  assert.equal(String(res.body.user.id).toLowerCase(), "yesblue0342");
  delete process.env.ADMIN_PASSWORD;
});

test("auth 핸들러: admin/admin 하드코딩 경로 유지", async () => {
  const { default: handler } = await import("../api/auth.js");
  const res = mockRes();
  await handler({ method: "POST", url: "/api/login", body: { mode: "login", id: "admin", password: "admin" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.id, "admin");
});

test("회귀 un-masking: 저장소(Drive) 장애를 401 '가입 정보 없음'이 아닌 503으로 명확히 알림", async () => {
  // 샌드박스엔 GOOGLE_DRIVE_FOLDER_ID 등 미설정 → readJsonFromDrive가 throw → readUser throw → 503.
  // 과거(catch{} 마스킹)엔 이 경우가 401 "가입 정보 없음"으로 둔갑해 관리자/회원 동시 장애의 원인이 안 보였음.
  delete process.env.ADMIN_PASSWORD; delete process.env.STELLA_ADMIN_PASSWORD;
  const { default: handler } = await import("../api/auth.js");
  const res = mockRes();
  await handler({ method: "POST", url: "/api/login", body: { mode: "login", id: "normaluser", password: "secret" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "AUTH_STORE_UNAVAILABLE");
});

test("저장소 장애여도 admin/admin·ADMIN_PASSWORD 관리자 경로는 통과(Drive 불필요)", async () => {
  process.env.ADMIN_PASSWORD = "kh-secret-1234";
  const { default: handler } = await import("../api/auth.js");
  const res1 = mockRes();
  await handler({ method: "POST", url: "/api/login", body: { mode: "login", id: "admin", password: "admin" } }, res1);
  assert.equal(res1.statusCode, 200);
  const res2 = mockRes();
  await handler({ method: "POST", url: "/api/login", body: { mode: "login", id: "yesblue0342", password: "kh-secret-1234" } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.user.status, "approved");
  delete process.env.ADMIN_PASSWORD;
});

test("canLogin/effectiveStatus: 하위호환(상태없음)·관리자는 approved (기존 계정 잠김 방지)", () => {
  assert.equal(effectiveStatus({ user_id: "olduser" }), "approved"); // status 없음 → approved
  assert.equal(canLogin({ user_id: "yesblue0342", status: "pending" }), true); // 관리자
  assert.equal(canLogin({ user_id: "u1", status: "pending" }), false);
  assert.equal(canLogin({ user_id: "u1", status: "approved" }), true);
});
