// Google Drive/Docs 공유 링크 감지(detectDriveLink) 테스트 — 링크만 붙여도 파일을 읽게 하는 기능.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDriveLink, detectDrivePathText } from "../lib/drive-utils.js";

test("drive.google.com/file/d/ID → fileId", () => {
  const r = detectDriveLink("이 파일 요약해줘 https://drive.google.com/file/d/1AbC_dEf-234567890xyz/view?usp=sharing");
  assert.deepEqual(r, { fileId: "1AbC_dEf-234567890xyz" });
});

test("drive.google.com/open?id=ID / uc?id=ID → fileId", () => {
  assert.deepEqual(detectDriveLink("https://drive.google.com/open?id=1234567890abcdefg"), { fileId: "1234567890abcdefg" });
  assert.deepEqual(detectDriveLink("https://drive.google.com/uc?id=1234567890abcdefg"), { fileId: "1234567890abcdefg" });
  assert.deepEqual(detectDriveLink("https://drive.google.com/uc?export=download&id=1234567890abcdefg"), { fileId: "1234567890abcdefg" });
});

test("drive.google.com/drive/folders/ID (u/N 포함) → folderId", () => {
  assert.deepEqual(detectDriveLink("https://drive.google.com/drive/folders/1QE3R13MkzmLbcyQjJFKSzcKoVRFYM5Yn"), { folderId: "1QE3R13MkzmLbcyQjJFKSzcKoVRFYM5Yn" });
  assert.deepEqual(detectDriveLink("https://drive.google.com/drive/u/0/folders/1QE3R13MkzmLbcyQjJFKSzcKoVRFYM5Yn"), { folderId: "1QE3R13MkzmLbcyQjJFKSzcKoVRFYM5Yn" });
});

test("docs.google.com 문서/시트/프레젠테이션 → fileId", () => {
  assert.deepEqual(detectDriveLink("https://docs.google.com/document/d/1abcDEF23456789/edit"), { fileId: "1abcDEF23456789" });
  assert.deepEqual(detectDriveLink("https://docs.google.com/spreadsheets/d/1abcDEF23456789/edit#gid=0"), { fileId: "1abcDEF23456789" });
  assert.deepEqual(detectDriveLink("https://docs.google.com/presentation/d/1abcDEF23456789/"), { fileId: "1abcDEF23456789" });
});

test("링크 없는 일반 문장 → null (오탐 없음)", () => {
  assert.equal(detectDriveLink("QM022 테스트 대본 만들어줘"), null);
  assert.equal(detectDriveLink("구글 드라이브 정리하는 법 알려줘"), null);
  assert.equal(detectDriveLink(""), null);
  assert.equal(detectDriveLink(null), null);
});

test("기존 #경로 감지는 회귀 없음", () => {
  assert.equal(detectDrivePathText("#StellaGPT > chatgpt"), "StellaGPT > chatgpt");
  assert.equal(detectDrivePathText("일반 질문"), "");
});
