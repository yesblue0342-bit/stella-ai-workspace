// lib/chat/system-prompt.mjs — 프롬프트 조립 순수 함수 테스트.
// "다운로드 기능이 없다"고 모델이 거절하던 회귀(CHANGES_LOOP_3.md)와
// Drive 환각 방지 규칙이 항상 붙는지 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, STELLA_SYSTEM_PROMPT, VFF_PREFIX } from "../lib/chat/system-prompt.mjs";

test("buildSystemPrompt: 다운로드 고지는 항상 붙는다", () => {
  const p = buildSystemPrompt("BASE", null, null);
  assert.ok(p.startsWith("BASE"), "기본 프롬프트가 앞에(프리픽스 캐싱)");
  assert.ok(p.includes("[다운로드/복사]"));
  assert.ok(p.includes("거짓 약속을 절대 하지 마세요"));
});

test("buildSystemPrompt: 검색 컨텍스트는 used+context 둘 다 있을 때만", () => {
  assert.ok(!buildSystemPrompt("B", { used: false, context: "X" }, null).includes("[실시간 컨텍스트]"));
  assert.ok(!buildSystemPrompt("B", { used: true }, null).includes("[실시간 컨텍스트]"));
  assert.ok(buildSystemPrompt("B", { used: true, context: "X" }, null).includes("[실시간 컨텍스트]\nX"));
});

test("buildSystemPrompt: Drive 컨텍스트가 있으면 환각 금지 규칙 4개가 붙는다", () => {
  const p = buildSystemPrompt("B", null, "읽은 파일: a.txt");
  assert.ok(p.includes("[Google Drive 실제 파일 내용]\n읽은 파일: a.txt"));
  assert.ok(p.includes("[★ 절대 규칙 - Google Drive 응답]"));
  assert.ok(p.includes("예시 표나 가상의 데이터를 만들지 마세요"));
});

test("buildSystemPrompt: null/undefined system 도 안전", () => {
  assert.ok(buildSystemPrompt(null, null, null).includes("[다운로드/복사]"));
});

test("상수: 기본 프롬프트와 VFF 프리픽스가 비어있지 않다", () => {
  assert.ok(STELLA_SYSTEM_PROMPT.includes("Stella GPT"));
  assert.ok(VFF_PREFIX.includes("VFF 모드"));
});
