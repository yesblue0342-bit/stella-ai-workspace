// Stella Hub 유틸 테스트 (작업 B). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import "../lib/hub-utils.js";
const H = globalThis.StellaHub;

test("classify: 텍스트/이미지/바이너리 분류", () => {
  assert.equal(H.classify("a.md"), "text");
  assert.equal(H.classify("ZPP_X_F01.abap"), "text");
  assert.equal(H.classify("README"), "text");
  assert.equal(H.classify("pic.PNG"), "image");
  assert.equal(H.classify("logo.svg"), "image");
  assert.equal(H.classify("app.zip"), "binary");
  assert.equal(H.classify("video.mp4"), "binary");
});

test("rawUrl: raw.githubusercontent 경로 + 한글 인코딩", () => {
  assert.equal(H.rawUrl("o", "r", "main", "dir/a.js"),
    "https://raw.githubusercontent.com/o/r/main/dir/a.js");
  assert.ok(H.rawUrl("o", "r", "main", "폴더/파일.txt").includes("%"), "한글 경로 인코딩");
});

test("rfc5987: 비ASCII 파일명 인코딩", () => {
  const e = H.rfc5987("보고서.txt");
  assert.ok(e.startsWith("UTF-8''"));
  assert.ok(/%[0-9A-F]{2}/.test(e));
});

test("filterFiles: 파일명 부분일치(대소문자 무시)", () => {
  const items = [{ name: "App.js" }, { name: "style.css" }, { name: "appendix.md" }];
  assert.deepEqual(H.filterFiles(items, "app").map(x => x.name), ["App.js", "appendix.md"]);
  assert.equal(H.filterFiles(items, "").length, 3);
});

test("sortContents: 폴더 먼저, 이름순", () => {
  const items = [{ name: "z.txt", type: "file" }, { name: "src", type: "dir" }, { name: "a.txt", type: "file" }, { name: "lib", type: "dir" }];
  assert.deepEqual(H.sortContents(items).map(x => x.name), ["lib", "src", "a.txt", "z.txt"]);
});

test("isRateLimited: 403 + rate limit 메시지", () => {
  assert.equal(H.isRateLimited(403, { message: "API rate limit exceeded" }), true);
  assert.equal(H.isRateLimited(403, { message: "Not Found" }), false);
  assert.equal(H.isRateLimited(200, {}), false);
});
