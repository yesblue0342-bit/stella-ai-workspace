// KST 날짜 유틸 테스트 (PART E) — 자정 경계 포함. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { kstDateString, familyPhotoPath, familyPhotoPathNow } from "../lib/kst-date.js";

test("kstDateString: UTC→KST(+9) 변환", () => {
  // 2026-06-17 03:00:00 UTC → KST 12:00 → 2026-06-17
  assert.equal(kstDateString(new Date("2026-06-17T03:00:00Z")), "2026-06-17");
});

test("kstDateString: KST 자정 경계 (UTC 15:00 = KST 다음날 00:00)", () => {
  // 2026-06-17T15:00:00Z = KST 2026-06-18 00:00:00 → 새 날짜
  assert.equal(kstDateString(new Date("2026-06-17T15:00:00Z")), "2026-06-18");
  // 1초 전(UTC 14:59:59) = KST 2026-06-17 23:59:59 → 아직 17일
  assert.equal(kstDateString(new Date("2026-06-17T14:59:59Z")), "2026-06-17");
});

test("kstDateString: 연/월 경계도 KST 기준", () => {
  // 2025-12-31T15:00:00Z = KST 2026-01-01 00:00 → 해 넘어감
  assert.equal(kstDateString(new Date("2025-12-31T15:00:00Z")), "2026-01-01");
  // 2026-02-28T15:00:00Z = KST 2026-03-01 (2026는 평년)
  assert.equal(kstDateString(new Date("2026-02-28T15:00:00Z")), "2026-03-01");
});

test("kstDateString: 형식 zero-pad", () => {
  assert.equal(kstDateString(new Date("2026-01-05T00:00:00Z")), "2026-01-05");
  assert.match(kstDateString(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

test("kstDateString: 잘못된 입력은 throw", () => {
  assert.throws(() => kstDateString("not-a-date"));
});

test("familyPhotoPath: 지정 경로 배열", () => {
  assert.deepEqual(familyPhotoPath("2026-06-18"), ["0가족", "1_사진", "stella talk", "2026-06-18"]);
});

test("familyPhotoPathNow: KST 날짜로 끝나는 경로", () => {
  const p = familyPhotoPathNow(new Date("2026-06-17T15:30:00Z"));
  assert.deepEqual(p, ["0가족", "1_사진", "stella talk", "2026-06-18"]);
});
