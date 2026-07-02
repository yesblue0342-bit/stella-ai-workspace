// 0Program 산출물 저장 파이프라인 테스트 (드라이브 자동저장 복구 미션).
// 실 Drive 업로드는 배포 후 스모크(deploy-oci.yml → _deploy_smoke.txt 업서트)가 검증하고,
// 여기서는 파일명 규칙·엔드포인트 안전성(항상 JSON)·소스가드 회귀를 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { programFileName } from "../lib/drive-files.mjs";
import handler from "../api/db/save-program.js";

function mockRes() {
  return {
    statusCode: 0, _json: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this._json = o; return this; },
  };
}

test("파일명 규칙: YYYYMMDD_HHmm_<앱>_<제목>.<확장자> (KST)", () => {
  // 2026-07-02 13:30 UTC = 2026-07-02 22:30 KST
  const d = new Date("2026-07-02T13:30:00Z");
  assert.equal(programFileName("codex", "zqm report", "abap", d), "20260702_2230_codex_zqm_report.abap");
  assert.equal(programFileName("Stella GPT", "테스트 대본", ".TXT", d), "20260702_2230_StellaGPT_테스트_대본.txt");
  // 확장자 무지정 → txt, 위험문자 제거
  assert.match(programFileName("a/b", "c:d", "", d), /^20260702_2230_a_b_c_d\.txt$/);
});

test("save-program: POST 외 405 JSON", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res._json.ok, false);
});

test("save-program: content 없으면 400 JSON", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { app: "x", title: "y" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res._json.ok, false);
});

test("save-program: Drive env 미설정이어도 throw 없이 JSON 에러(500)", async () => {
  // CI 컨테이너엔 GOOGLE_* env 가 없음 → getDrive/ensurePath 가 던지는 경로.
  const res = mockRes();
  await handler({ method: "POST", body: { app: "t", title: "t", content: "hello" } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res._json.ok, false);
  assert.ok(typeof res._json.error === "string" && res._json.error.length > 0);
  // 시크릿 값 노출 금지(에러 메시지에 키/토큰 형태 문자열 없어야)
  assert.ok(!/AIza|ya29\.|ghp_|refresh_token=/i.test(res._json.error));
});

test("save-program: dryRun 도 env 미설정 시 JSON 에러(비정상 종료 없음)", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { dryRun: true } }, res);
  assert.ok(res.statusCode === 200 || res.statusCode === 500, "JSON 응답 보장");
  assert.ok(res._json && typeof res._json.ok === "boolean");
});

test("소스 가드 회귀: 코드펜스 답변만 자동저장 통과", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../js/source-guard.js", import.meta.url), "utf8");
  const win = {};
  new Function("window", "module", src)(win, undefined);
  const shouldSaveSource = win.shouldSaveSource;
  assert.equal(shouldSaveSource("```abap\nWRITE 'x'.\n```"), true);
  assert.equal(shouldSaveSource("일반 대화 답변입니다"), false);
  assert.equal(shouldSaveSource("죄송하지만 도와드릴 수 없습니다 ```x```"), false);
});

test("Stella GPT 자동저장 연결(소스 검증)", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /source-guard\.js/, "index.html 이 source-guard 로드");
  assert.match(html, /app:'StellaGPT',programName:_pn/, "답변 후 0Program 자동저장 호출 존재");
});
