// 하드코딩 화이트리스트 로그인 + admin(yesblue0342) + 내부에러 노출제거 + 유저ID 고정.
// 순수함수 + 실제 핸들러(api/auth.js) 호출. Drive/네트워크/비밀값 없음.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWLIST, isAllowlisted, allowlistUser, toUserError, hasBannedTerm } from "../lib/login-allow.js";

const BANNED_WORDS = ["Google Drive", "Drive", "환경 변수", "환경변수", "environment", "env"];
function hasAnyBanned(s){ return BANNED_WORDS.some(w => String(s||"").includes(w)); }

function mockRes(){ return { statusCode:0, body:null, status(c){this.statusCode=c;return this;}, json(o){this.body=o;return this;} }; }
async function login(body){
  const { default: handler } = await import("../api/auth.js");
  const res = mockRes();
  await handler({ method:"POST", url:"/api/login", body:{ mode:"login", ...body } }, res);
  return res;
}

// ── 순수함수 ──
test("ALLOWLIST = yesblue0342/dmswn8712/mjlee", () => {
  assert.deepEqual(ALLOWLIST, ["yesblue0342", "dmswn8712", "mjlee"]);
});
test("isAllowlisted: 대소문자 무시, 비-allowlist 거부", () => {
  assert.equal(isAllowlisted("yesblue0342"), true);
  assert.equal(isAllowlisted("MJLEE"), true);
  assert.equal(isAllowlisted("stranger"), false);
  assert.equal(isAllowlisted(""), false);
});
test("allowlistUser: id=username 고정, role/isAdmin", () => {
  assert.deepEqual(
    { id: allowlistUser("yesblue0342").id, role: allowlistUser("yesblue0342").role, isAdmin: allowlistUser("yesblue0342").isAdmin },
    { id: "yesblue0342", role: "admin", isAdmin: true });
  assert.equal(allowlistUser("mjlee").isAdmin, false);
  assert.equal(allowlistUser("MJLEE").id, "mjlee"); // 정규화 고정
});

// ── (a) 3개 ID는 틀린/빈 비밀번호로 로그인 성공 ──
test("(a) allowlist + 틀린 비밀번호 → 200 성공", async () => {
  for(const id of ALLOWLIST){
    const r = await login({ id, password: "WRONG_PASSWORD" });
    assert.equal(r.statusCode, 200, id);
    assert.equal(r.body.ok, true, id);
    assert.equal(r.body.user.id, id, id);
  }
});
test("(a) allowlist + 빈 비밀번호 → 200 성공", async () => {
  for(const id of ALLOWLIST){
    const r = await login({ id, password: "" });
    assert.equal(r.statusCode, 200, id);
    assert.equal(r.body.user.id, id, id);
  }
});

// ── (b) yesblue0342 = admin ──
test("(b) yesblue0342 → isAdmin true, role admin", async () => {
  const r = await login({ id: "yesblue0342", password: "" });
  assert.equal(r.body.user.isAdmin, true);
  assert.equal(r.body.user.role, "admin");
});

// ── (c) 나머지는 일반 권한 ──
test("(c) dmswn8712·mjlee → isAdmin false, role user", async () => {
  for(const id of ["dmswn8712", "mjlee"]){
    const r = await login({ id, password: "x" });
    assert.equal(r.body.user.isAdmin, false, id);
    assert.equal(r.body.user.role, "user", id);
  }
});

// ── (d) 사용자 노출 에러에 금칙어 미포함 ──
test("(d) toUserError/hasBannedTerm: 금칙어 미포함 보장", () => {
  const dirty = "Google Drive 환경변수 process.env.GOOGLE_REFRESH_TOKEN 오류 (/auth/users/x.js:12)";
  assert.equal(hasBannedTerm(dirty), true);              // 더러운 입력은 감지
  const out = toUserError(new Error(dirty));
  assert.equal(hasAnyBanned(out), false);                // 매핑 결과엔 금칙어 없음
  assert.equal(hasBannedTerm(out), false);
});
test("(d) 비-allowlist 로그인 실패 메시지에 금칙어 없음", async () => {
  // Drive env 없는 샌드박스 → 저장소 오류여도 화면 문구는 일반/금칙어 없음
  const r = await login({ id: "stranger", password: "nope" });
  assert.ok(r.statusCode === 401 || r.statusCode === 500, "실패 응답");
  assert.equal(hasAnyBanned(r.body.message), false, "message: " + r.body.message);
  assert.equal(r.body.error, undefined, "내부 error 필드 미노출");
});

// ── (e) 동일 username 재로그인 시 유저 ID 동일(고정) ──
test("(e) 동일 username 재로그인 → 같은 user.id (난수 아님)", async () => {
  const r1 = await login({ id: "mjlee", password: "a" });
  const r2 = await login({ id: "mjlee", password: "b" });
  assert.equal(r1.body.user.id, r2.body.user.id);
  assert.equal(r1.body.user.id, "mjlee");
  // 대문자로 들어와도 정규화되어 동일 id
  const r3 = await login({ id: "MJLEE", password: "c" });
  assert.equal(r3.body.user.id, "mjlee");
});
