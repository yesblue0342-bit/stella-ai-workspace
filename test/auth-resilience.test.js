// Drive 독립 로그인 회귀 보호 — 순수함수 + 핸들러 allowlist 경로(네트워크/Drive 호출 없음).
// 비밀값 미포함: 테스트용 더미 비번("DUMMYPW")만 런타임 env에 주입 후 복원.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ALLOWLIST, resolveAllowedId, getMemberPw, getMemberMeta,
  membersConfigured, adminPasswordConfigured,
} from "../lib/approval.js";

const DUMMY = "DUMMYPW"; // 실 비밀 아님(테스트 픽스처)

// auth.js makeHash와 동일 파라미터로 salt:hash 생성
function makeHash(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(secret), salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}
function withEnv(vars, fn) {
  const keys = ["STELLA_MEMBERS", "ADMIN_PASSWORD", "STELLA_ADMIN_PASSWORD"];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const k of Object.keys(vars)) process.env[k] = vars[k];
  return Promise.resolve(fn()).finally(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}
function mockRes() {
  return { statusCode: 0, body: null, status(c){ this.statusCode=c; return this; }, json(o){ this.body=o; return this; } };
}
async function login(body) {
  const { default: handler } = await import("../api/auth.js");
  const res = mockRes();
  await handler({ method: "POST", url: "/api/login", body: { mode: "login", ...body } }, res);
  return res;
}

test("ALLOWLIST: 지정 4개 식별자", () => {
  assert.deepEqual(ALLOWLIST, ["yesblue0342", "dmswn8712", "mjlee", "stellanight"]);
});

test("resolveAllowedId: allowlist id 통과(대소문자 무시), 비-allowlist null", () => withEnv({}, () => {
  assert.equal(resolveAllowedId("mjlee", ""), "mjlee");
  assert.equal(resolveAllowedId("MJLEE", ""), "mjlee");
  assert.equal(resolveAllowedId("randomguy", ""), null);
  assert.equal(resolveAllowedId("", ""), null);
}));

test("resolveAllowedId: email→id 매핑(STELLA_MEMBERS email)", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ mjlee: { pw: DUMMY, email: "mj@x.com", name: "MJ" } }) },
  () => {
    assert.equal(resolveAllowedId("nomatchid", "mj@x.com"), "mjlee");
    assert.equal(resolveAllowedId("nomatchid", "other@x.com"), null);
  }
));

test("getMemberPw: 문자열·객체.pw 추출, 없으면 ''", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ mjlee: DUMMY, dmswn8712: { pw: "H", email: "d@x.com" } }) },
  () => {
    assert.equal(getMemberPw("mjlee"), DUMMY);
    assert.equal(getMemberPw("DMSWN8712"), "H");
    assert.equal(getMemberPw("stellanight"), "");
  }
));

test("getMemberMeta: 객체 email/name", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ yesblue0342: { pw: DUMMY, email: "y@naver.com", name: "이후" } }) },
  () => assert.deepEqual(getMemberMeta("yesblue0342"), { email: "y@naver.com", name: "이후" })
));

test("membersConfigured / adminPasswordConfigured true·false", () => withEnv({}, () => {
  assert.equal(membersConfigured(), false);
  assert.equal(adminPasswordConfigured(), false);
  return withEnv({ STELLA_MEMBERS: JSON.stringify({ mjlee: DUMMY }), ADMIN_PASSWORD: "x" }, () => {
    assert.equal(membersConfigured(), true);
    assert.equal(adminPasswordConfigured(), true);
  });
}));

test("verify 계약: 평문·salt:hash 둘 다 통과/거부 (auth.js verify와 동일 알고리즘)", () => {
  // auth.js verify를 동일 알고리즘으로 재현해 계약 검증
  function verify(secret, stored){
    if(!stored) return false; const s=String(stored);
    if(s.includes(":")){ const [salt,hash]=s.split(":"); return crypto.pbkdf2Sync(String(secret),salt,100000,64,"sha512").toString("hex")===hash; }
    return String(secret)===s;
  }
  assert.equal(verify(DUMMY, DUMMY), true);
  assert.equal(verify("nope", DUMMY), false);
  const h = makeHash(DUMMY);
  assert.equal(verify(DUMMY, h), true);
  assert.equal(verify("nope", h), false);
});

// ── 핸들러 allowlist 경로 (Drive 호출 0회) ──
test("핸들러: allowlist + 평문 비번 → 200 (Drive 없이)", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ mjlee: DUMMY }) },
  async () => { const r = await login({ id: "mjlee", password: DUMMY }); assert.equal(r.statusCode, 200); assert.equal(r.body.user.id, "mjlee"); assert.equal(r.body.user.status, "approved"); }
));

test("핸들러: allowlist + salt:hash 비번 → 200", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ stellanight: { pw: makeHash(DUMMY), email: "s@x.com", name: "S" } }) },
  async () => { const r = await login({ id: "stellanight", password: DUMMY }); assert.equal(r.statusCode, 200); assert.equal(r.body.user.email, "s@x.com"); }
));

test("핸들러: allowlist + 틀린 비번 → 401", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ mjlee: DUMMY }) },
  async () => { const r = await login({ id: "mjlee", password: "WRONG" }); assert.equal(r.statusCode, 401); }
));

test("핸들러: STELLA_MEMBERS 미설정 + allowlist id → 503 MEMBERS_UNSET", () => withEnv(
  {}, async () => { const r = await login({ id: "mjlee", password: DUMMY }); assert.equal(r.statusCode, 503); assert.equal(r.body.code, "MEMBERS_UNSET"); }
));

test("핸들러: allowlist지만 해당 id 비번 없음 → 503 MEMBER_PW_UNSET", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ dmswn8712: DUMMY }) },
  async () => { const r = await login({ id: "mjlee", password: DUMMY }); assert.equal(r.statusCode, 503); assert.equal(r.body.code, "MEMBER_PW_UNSET"); }
));

test("핸들러: 비-allowlist + members 운영중 → 403 NOT_ALLOWLISTED (Drive 안 읽음)", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ mjlee: DUMMY }) },
  async () => { const r = await login({ id: "randomguy", password: DUMMY }); assert.equal(r.statusCode, 403); assert.equal(r.body.code, "NOT_ALLOWLISTED"); }
));

test("핸들러: signup 모드 → 403 SIGNUP_DISABLED", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ mjlee: DUMMY }) },
  async () => {
    const { default: handler } = await import("../api/auth.js");
    const res = mockRes();
    await handler({ method: "POST", url: "/api/signup", body: { mode: "signup", id: "newperson", email: "n@x.com", password: "abcd", name: "New" } }, res);
    assert.equal(res.statusCode, 403); assert.equal(res.body.code, "SIGNUP_DISABLED");
  }
));

test("핸들러: 부트스트랩 admin/admin은 members 운영중이면 비활성(공개 구멍 차단)", () => withEnv(
  { STELLA_MEMBERS: JSON.stringify({ mjlee: DUMMY }) },
  async () => { const r = await login({ id: "admin", password: "admin" }); assert.notEqual(r.statusCode, 200); }
));
