import { test } from "node:test";
import assert from "node:assert/strict";
import { needsWebSearch, wantsTable, buildSystemPrompt, pickModel, extractText } from "../lib/router.mjs";

test("실시간 질문은 검색", () => {
  assert.equal(needsWebSearch("2026년 6월 22일 기준 한국 월드컵 승패는?"), true);
  assert.equal(needsWebSearch("오늘 서울 날씨"), true);
  assert.equal(needsWebSearch("삼성전자 주가"), true);
});
test("일반 질문은 검색 안 함", () => {
  assert.equal(needsWebSearch("안녕"), false);
  assert.equal(needsWebSearch("파이썬 리스트 뒤집기"), false);
});
test("표는 요청 시만", () => {
  assert.equal(wantsTable("표로 정리해줘"), true);
  assert.equal(wantsTable("비교표 만들어줘"), true);
  assert.equal(wantsTable("월드컵 승패 알려줘"), false);
});
test("기본은 표 금지 / 요청 시 허용", () => {
  assert.match(buildSystemPrompt({ table: false }), /표를 만들지 않습니다/);
  assert.match(buildSystemPrompt({ table: true }), /마크다운 표로 정리/);
});
test("메모리는 extra로 보존", () => {
  assert.match(buildSystemPrompt({ extra: "KH 메모리: 테스트" }), /KH 메모리: 테스트/);
});
test("모델 분기", () => {
  assert.equal(pickModel({ search: true }), "gpt-4o");
  assert.equal(pickModel({ search: false }), "gpt-4o-mini");
});
test("Responses 출력 파싱", () => {
  assert.equal(extractText({ output: [{ type: "message", content: [{ type: "output_text", text: "1승 1패" }] }] }), "1승 1패");
  assert.equal(extractText({ output_text: "ok" }), "ok");
  assert.equal(extractText({ output: [] }), "응답을 생성하지 못했습니다.");
});
