// 0Program 저장 가드 단위 테스트. (브라우저 classic script → window.shouldSaveSource 를 추출해 검증)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "js", "source-guard.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win); // IIFE 실행 → win.shouldSaveSource 설정
const shouldSaveSource = win.shouldSaveSource;

test("export 확인", () => assert.equal(typeof shouldSaveSource, "function"));
test("코드펜스 있는 실제 소스 → 저장", () => {
  assert.equal(shouldSaveSource("다음과 같습니다.\n```abap\nREPORT zaqmr0040.\n```"), true);
});
test("거부 응답 → 차단", () => {
  assert.equal(shouldSaveSource("죄송하지만, 첨부 파일을 직접 확인할 수 없습니다."), false);
  assert.equal(shouldSaveSource("I cannot see the attachment."), false);
  assert.equal(shouldSaveSource("응답 없음"), false);
  assert.equal(shouldSaveSource("API 연결 오류: timeout"), false);
});
test("코드펜스 없으면 차단", () => {
  assert.equal(shouldSaveSource("REPORT zaqmr0040. (코드블록 아님)"), false);
});
test("빈/공백/null → 차단", () => {
  assert.equal(shouldSaveSource(""), false);
  assert.equal(shouldSaveSource("   "), false);
  assert.equal(shouldSaveSource(null), false);
});
test("코드펜스 + 거부문구 동시 → 차단(보수적)", () => {
  assert.equal(shouldSaveSource("죄송하지만 ```abap REPORT z. ```"), false);
});
