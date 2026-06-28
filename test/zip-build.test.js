// test/zip-build.test.js — 압축(zip) 공용 헬퍼 + fflate 압축/해제 라운드트립 검증. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeZipName, timestampName, dedupeZipPath } from "../lib/zipbuild.js";

test("sanitizeZipName: 한글 이름 → <이름>.zip", () => {
  assert.equal(sanitizeZipName("보고서"), "보고서.zip");
  assert.equal(sanitizeZipName("프로젝트 자료"), "프로젝트 자료.zip", "공백 보존");
});

test("sanitizeZipName: 금지문자 치환 + 기존 .zip 중복 방지", () => {
  assert.equal(sanitizeZipName("a/b:c*?.zip"), "a_b_c__.zip", "금지문자만 _ 로, .zip 한 번만");
  assert.equal(sanitizeZipName("report.zip"), "report.zip");
  assert.equal(sanitizeZipName("REPORT.ZIP"), "REPORT.zip", "대소문자 무관 .zip 제거 후 재부착");
});

test("sanitizeZipName: 빈/공백/null → '' (호출측 타임스탬프 폴백)", () => {
  assert.equal(sanitizeZipName(""), "");
  assert.equal(sanitizeZipName("   "), "");
  assert.equal(sanitizeZipName(null), "");
  assert.equal(sanitizeZipName(undefined), "");
});

test("sanitizeZipName: 120자 길이 제한", () => {
  const long = "가".repeat(300);
  const out = sanitizeZipName(long);
  assert.ok(out.endsWith(".zip"));
  assert.equal(out.length, 120 + 4, "본문 120자 + '.zip'");
});

test("timestampName: 압축_YYYYMMDD_HHMM.zip 포맷", () => {
  assert.equal(timestampName(new Date(2026, 5, 28, 6, 7)), "압축_20260628_0607.zip");
  assert.match(timestampName(), /^압축_\d{8}_\d{4}\.zip$/);
});

test("dedupeZipPath: 중복 경로에 ' (n)' 접미사(디렉터리·확장자 보존)", () => {
  const used = new Set();
  assert.equal(dedupeZipPath("폴더/a.txt", used), "폴더/a.txt");
  assert.equal(dedupeZipPath("폴더/a.txt", used), "폴더/a (1).txt");
  assert.equal(dedupeZipPath("폴더/a.txt", used), "폴더/a (2).txt");
  assert.equal(dedupeZipPath("b", used), "b", "확장자 없는 이름");
  assert.equal(dedupeZipPath("b", used), "b (1)");
});

// 압축/해제 코어가 실제로 동작하는지 — 의존성(fflate)이 설치된 환경에서만 실행.
test("fflate 라운드트립: 압축한 zip을 해제하면 원본 그대로 (한글 경로 포함)", async (t) => {
  let fflate;
  try { fflate = await import("fflate"); }
  catch { return t.skip("fflate 미설치 — Docker 빌드 환경에서 검증"); }
  const { zipSync, unzipSync, strToU8, strFromU8 } = fflate;

  const used = new Set();
  const src = {
    [dedupeZipPath("문서/메모.txt", used)]: strToU8("안녕하세요 Stella"),
    [dedupeZipPath("data.json", used)]: strToU8(JSON.stringify({ ok: true, n: 42 })),
    [dedupeZipPath("문서/메모.txt", used)]: strToU8("중복 경로 → (1)"),
  };
  const zipped = zipSync(src, { level: 6 });
  assert.ok(zipped.length > 0, "zip 바이트 생성");

  const back = unzipSync(zipped);
  const keys = Object.keys(back).sort();
  assert.deepEqual(keys, ["data.json", "문서/메모 (1).txt", "문서/메모.txt"].sort());
  assert.equal(strFromU8(back["문서/메모.txt"]), "안녕하세요 Stella");
  assert.equal(strFromU8(back["문서/메모 (1).txt"]), "중복 경로 → (1)");
  assert.deepEqual(JSON.parse(strFromU8(back["data.json"])), { ok: true, n: 42 });
});
