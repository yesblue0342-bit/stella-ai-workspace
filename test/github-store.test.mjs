import { test } from "node:test"; import assert from "node:assert/strict";
import { toRepoPath, toBase64, fromBase64, buildPutBody, parseShaFromContents, deriveAbapName, resolveProgramName } from "../lib/github-store.mjs";

test("deriveAbapName: REPORT/CLASS/FORM/Z식별자 우선순위", () => {
  assert.equal(deriveAbapName("```abap\nREPORT zaqmr0040.\n```"), "ZAQMR0040");
  assert.equal(deriveAbapName("CLASS zcl_demo DEFINITION."), "ZCL_DEMO");
  assert.equal(deriveAbapName("FORM get_data.\nENDFORM."), "GET_DATA");
  assert.equal(deriveAbapName("호출 ZIF_FOO 인터페이스"), "ZIF_FOO");
});
test("deriveAbapName: 못 찾으면 program_타임스탬프", () => {
  assert.match(deriveAbapName("그냥 한글 문장 코드없음"), /^program_\d{8}_\d{6}$/);
});
test("resolveProgramName: 한글문장/빈값은 소스에서 추출, 유효명은 보존", () => {
  assert.equal(resolveProgramName("ZAQMR0040", "REPORT zaqmr0040."), "ZAQMR0040");
  assert.equal(resolveProgramName("첨부의 스펙 참고해서 개발해줘", "REPORT zaqmr0040."), "ZAQMR0040"); // 공백=문장 → 추출
  assert.equal(resolveProgramName("", "CLASS zcl_x DEFINITION."), "ZCL_X");
  assert.match(resolveProgramName("abcd", "코드없음"), /^program_\d{8}_\d{6}$/); // Z/Y 미시작 → 추출(없으니 ts)
});
test("경로: 일반명", () => assert.equal(toRepoPath("ZQM_INSPECTION_01"), "src/ZQM_INSPECTION_01.abap"));
test("경로: 확장자 유지", () => assert.equal(toRepoPath("Report.abap"), "src/Report.abap"));
test("경로: 한글 보존/치환", () => assert.equal(toRepoPath("검사로트 #1"), "src/검사로트_1.abap"));
test("경로: 빈 이름", () => assert.match(toRepoPath(""), /^src\/program_\d+\.abap$/));
test("경로: 후행 점 → '..txt' 방지", () => assert.equal(toRepoPath("개발해줘.", "txt"), "src/개발해줘.txt"));
test("경로: 긴 요청문장 길이 제한(≤60) + 끝 구분자 정리", () => {
  const p = toRepoPath("첨부의 프로그램 스펙을 참고해서 프로그램을 개발해줘 ".repeat(5), "txt");
  const base = p.replace(/^src\//, "").replace(/\.txt$/, "");
  assert.ok(base.length <= 60, "base len " + base.length);
  assert.ok(!/\.\.txt$/.test(p), "double-dot 없어야");
  assert.ok(!/[._-]$/.test(base), "끝 구분자 없어야");
});
test("base64 라운드트립", () => { assert.equal(fromBase64(toBase64("한글 ABAP")), "한글 ABAP"); assert.equal(toBase64("ABC"), "QUJD"); });
test("PUT 바디: create(sha 없음)", () => { const b = buildPutBody({ content: "X", message: "m" }); assert.equal(b.content, toBase64("X")); assert.equal("sha" in b, false); });
test("PUT 바디: update(sha 있음)", () => assert.equal(buildPutBody({ content: "X", sha: "abc" }).sha, "abc"));
test("sha 파싱", () => { assert.equal(parseShaFromContents({ sha: "d" }), "d"); assert.equal(parseShaFromContents({}), null); });
