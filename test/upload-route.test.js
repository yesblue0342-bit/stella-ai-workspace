// 업로드 경로 선택 테스트 (C1). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import "../lib/upload-route.js";
const U = globalThis.StellaUpload;

test("useResumable: 3MB 초과는 resumable, 이하는 base64", () => {
  assert.equal(U.useResumable(1 * 1024 * 1024), false, "1MB → base64");
  assert.equal(U.useResumable(3 * 1024 * 1024), false, "정확히 3MB → base64");
  assert.equal(U.useResumable(3 * 1024 * 1024 + 1), true, "3MB 초과 → resumable");
  assert.equal(U.useResumable(21 * 1024 * 1024), true, "21MB 동영상 → resumable");
});

test("useResumable: 커스텀 한도", () => {
  assert.equal(U.useResumable(2 * 1024 * 1024, 1 * 1024 * 1024), true);
  assert.equal(U.useResumable(0), false);
  assert.equal(U.useResumable(undefined), false);
});
