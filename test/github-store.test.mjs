import { test } from "node:test"; import assert from "node:assert/strict";
import { toRepoPath, toBase64, fromBase64, buildPutBody, parseShaFromContents } from "../lib/github-store.mjs";
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
