// Phase 6 단위 테스트: 승인 로직 (node --test 불필요, 순수 assert)
import assert from "assert";
import {
  isAdmin, effectiveStatus, canLogin, loginDenialMessage, isValidTransition, ADMIN_IDS
} from "../lib/approval.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  PASS  " + name); }
  catch (e) { fail++; console.log("  FAIL  " + name + " :: " + e.message); }
}

console.log("[1] isAdmin 대소문자 무시");
t("yesblue0342 → admin", () => assert.strictEqual(isAdmin("yesblue0342"), true));
t("YESBLUE0342 (대문자) → admin", () => assert.strictEqual(isAdmin("YESBLUE0342"), true));
t("YesBlue0342 (혼합) → admin", () => assert.strictEqual(isAdmin("YesBlue0342"), true));
t("  admin  (공백) → admin", () => assert.strictEqual(isAdmin("  admin  "), true));
t("ADMIN → admin", () => assert.strictEqual(isAdmin("ADMIN"), true));
t("normaluser → not admin", () => assert.strictEqual(isAdmin("normaluser"), false));
t("빈값 → not admin", () => assert.strictEqual(isAdmin(""), false));
t("null → not admin", () => assert.strictEqual(isAdmin(null), false));

console.log("[2] 하위호환: status 없는 user → approved");
t("status 필드 없음 → approved", () => assert.strictEqual(effectiveStatus({ id: "olduser" }), "approved"));
t("status 없는 user canLogin true", () => assert.strictEqual(canLogin({ id: "olduser" }), true));
t("status '' (빈문자) → approved", () => assert.strictEqual(effectiveStatus({ id: "u", status: "" }), "approved"));
t("status null → approved", () => assert.strictEqual(effectiveStatus({ id: "u", status: null }), "approved"));

console.log("[3] status 전이 로직 (pending → approved / rejected)");
t("pending → 로그인 차단", () => assert.strictEqual(canLogin({ id: "newbie", status: "pending" }), false));
t("approved → 로그인 통과", () => assert.strictEqual(canLogin({ id: "newbie", status: "approved" }), true));
t("rejected → 로그인 차단", () => assert.strictEqual(canLogin({ id: "newbie", status: "rejected" }), false));
t("pending 메시지", () => assert.strictEqual(loginDenialMessage({ id: "n", status: "pending" }), "관리자 승인 대기 중입니다."));
t("rejected 메시지", () => assert.strictEqual(loginDenialMessage({ id: "n", status: "rejected" }), "가입이 거절되었습니다."));
t("approved 메시지 없음", () => assert.strictEqual(loginDenialMessage({ id: "n", status: "approved" }), null));

console.log("[4] 관리자는 DB 상태 무관 항상 approved");
t("admin + status pending → approved", () => assert.strictEqual(effectiveStatus({ id: "admin", status: "pending" }), "approved"));
t("admin + status rejected → approved", () => assert.strictEqual(effectiveStatus({ id: "admin", status: "rejected" }), "approved"));
t("yesblue0342 + pending → 로그인 통과", () => assert.strictEqual(canLogin({ user_id: "yesblue0342", status: "pending" }), true));
t("YESBLUE0342 + rejected → 로그인 통과", () => assert.strictEqual(canLogin({ id: "YESBLUE0342", status: "rejected" }), true));

console.log("[5] 상태 전이 대상 검증 (비관리자 호출 차단 로직의 일부)");
t("approved 허용", () => assert.strictEqual(isValidTransition("approved"), true));
t("rejected 허용", () => assert.strictEqual(isValidTransition("rejected"), true));
t("pending 거부 (관리자가 임의로 pending 못 만듦)", () => assert.strictEqual(isValidTransition("pending"), false));
t("임의 문자열 거부", () => assert.strictEqual(isValidTransition("deleted"), false));

console.log("[6] 비관리자 승인 호출 차단 (서버측 권한 게이트 시뮬레이션)");
// admin-approvals 엔드포인트가 사용하는 게이트: isAdmin(caller) === false → 거부
function approvalGate(callerId) { return isAdmin(callerId); }
t("비관리자 호출 → 차단", () => assert.strictEqual(approvalGate("randombot"), false));
t("관리자 호출 → 허용", () => assert.strictEqual(approvalGate("yesblue0342"), true));
t("대문자 관리자 호출 → 허용", () => assert.strictEqual(approvalGate("Admin"), true));

console.log("\n결과: " + pass + " PASS / " + fail + " FAIL  (총 " + (pass + fail) + ")");
console.log("ADMIN_IDS = " + JSON.stringify(ADMIN_IDS));
if (fail > 0) process.exit(1);
