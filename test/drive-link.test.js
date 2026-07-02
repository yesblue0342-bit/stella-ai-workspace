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

// 회귀: "#"나 "내 드라이브 > ..." 형식 없이 자연어로 중첩 폴더를 물으면 경로를 인식 못해
// buildDriveContextForChat이 null → "정확한 폴더명으로 다시 시도하라"는 안내만 반복하던 버그.
test("자연어 중첩 폴더 경로: 'A 폴더 하위의 B 폴더' → 'A > B'", () => {
  const msg = "구글 드라이브 폴더 내 StellaGpt 폴더 하위의 Chatgpt 폴더 하위에 보면 Stella 개발 관련 파일 리스트를 알려주고 각 파일들의 내용을 표로 정리해줘";
  assert.equal(detectDrivePathText(msg), "StellaGpt > Chatgpt");
});

test("자연어 단일 폴더: '구글 드라이브 SAP 폴더 확인해줘' → 'SAP'", () => {
  assert.equal(detectDrivePathText("구글 드라이브 SAP 폴더 확인해줘"), "SAP");
});

test("자연어 폴더 오탐 방지: '폴더' 없이 드라이브만 언급하면 빈 문자열", () => {
  assert.equal(detectDrivePathText("구글 드라이브 정리하는 법 알려줘"), "");
});

test("기존 '내 드라이브 > ...' 형식은 회귀 없음", () => {
  assert.equal(detectDrivePathText("내 드라이브 > 문서 > 보고서"), "내 드라이브 > 문서 > 보고서");
});
