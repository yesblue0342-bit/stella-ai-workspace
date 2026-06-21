// C2: StellaGPT/0download .txt 저장 — 순수 헬퍼(파일명/내용/타임스탬프) 단위 테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import { txtFileName, txtContent, tsKST } from "../lib/drive-files.mjs";

const D = new Date(Date.UTC(2026, 5, 21, 0, 30, 5)); // KST(+9h) = 2026-06-21 09:30:05

test("tsKST: KST 기준 YYYYMMDD_HHMMSS", () => {
  assert.equal(tsKST(D), "20260621_093005");
});

test("txtFileName: {앱명}_{타임스탬프}.txt 패턴", () => {
  assert.match(txtFileName("StellaCodex", D), /^StellaCodex_\d{8}_\d{6}\.txt$/);
});

test("txtFileName: 공백 제거 + 정확 일치", () => {
  assert.equal(txtFileName("Stella Agent Code", D), "StellaAgentCode_20260621_093005.txt");
});

test("txtFileName: 앱명 비면 기본 Stella", () => {
  assert.match(txtFileName("", D), /^Stella_\d{8}_\d{6}\.txt$/);
});

test("txtContent: 요청 헤더 한 줄 + 빈 줄 + 결과 전문", () => {
  assert.equal(txtContent("버블 정렬 짜줘", "코드입니다"), "[요청] 버블 정렬 짜줘\n\n코드입니다");
});

test("txtContent: 헤더 공백 collapse", () => {
  assert.equal(txtContent("  여러   공백 \n 줄 ", "x"), "[요청] 여러 공백 줄\n\nx");
});

test("txtContent: 헤더 없으면 본문만", () => {
  assert.equal(txtContent("", "본문만"), "본문만");
  assert.equal(txtContent(null, "a"), "a");
});
