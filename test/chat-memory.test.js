// lib/chat/memory.mjs — 메모리 순수 함수 + 비용 절감 게이트 테스트.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  memoryToPrompt, addUnique, shouldExtractMemory, hasMemoryItems,
  needsFullMemory, extractMemoryFromConversation,
} from "../lib/chat/memory.mjs";

test("memoryToPrompt: 빈 메모리는 빈 문자열", () => {
  assert.equal(memoryToPrompt(null), "");
  assert.equal(memoryToPrompt({ facts: [], patterns: [], preferences: [], context: [] }), "");
});

test("memoryToPrompt: 카테고리별 섹션 + 갱신일 표기", () => {
  const p = memoryToPrompt({
    facts: ["KH는 SAP QM 컨설턴트"],
    preferences: ["표로 요약 선호"],
    context: [], patterns: [],
    updatedAt: "2026-07-10T01:02:03.000Z",
  });
  assert.ok(p.includes("[KH 알려진 사실]\n• KH는 SAP QM 컨설턴트"));
  assert.ok(p.includes("[KH 선호도]\n• 표로 요약 선호"));
  assert.ok(!p.includes("[현재 업무 맥락]"), "빈 카테고리는 생략");
  assert.ok(p.includes("(2026-07-10 기준)"));
});

test("addUnique: 대소문자·공백 무시 중복 제거 + 최대개수 유지", () => {
  assert.deepEqual(addUnique(["A"], [" a ", "B"], 10), ["A", "B"]);
  assert.deepEqual(addUnique(["x"], [], 10), ["x"]);
  assert.deepEqual(addUnique(["1", "2", "3"], ["4"], 2), ["3", "4"], "뒤에서 maxN개만");
});

test("shouldExtractMemory: 맞장구·인사는 추출 LLM 호출을 건너뛴다(비용 절감)", () => {
  for (const trivial of ["ㅇㅇ", "네", "고마워", "감사합니다", "ok", "Thanks!", "이어서 계속", "continue", "ㅋㅋㅋ"]) {
    assert.equal(shouldExtractMemory(trivial), false, `trivial: ${trivial}`);
  }
  assert.equal(shouldExtractMemory("나는 셀트리온 BISON 프로젝트를 하고 있어"), true);
  assert.equal(shouldExtractMemory("QA32 사용법 알려줘"), true);
  assert.equal(shouldExtractMemory(""), false);
});

test("extractMemoryFromConversation: 사소한 발화면 네트워크 호출 없이 null", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("호출되면 안 됨"); };
  try {
    assert.equal(await extractMemoryFromConversation({ history: [], message: "고마워", answer: "네", isClaudeModel: false }), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("hasMemoryItems: 하나라도 비어있지 않은 배열이 있으면 true", () => {
  assert.equal(hasMemoryItems(null), false);
  assert.equal(hasMemoryItems({ facts: [], context: [] }), false);
  assert.equal(hasMemoryItems({ facts: [], context: ["x"] }), true);
});

test("needsFullMemory: 첫 대화이거나 명시적 기억 요청일 때만 폴더 전체 스캔", () => {
  assert.equal(needsFullMemory([], "안녕"), true);
  assert.equal(needsFullMemory([{ role: "user", content: "a" }], "내가 뭐라 했는지 기억해?"), true);
  assert.equal(needsFullMemory([{ role: "user", content: "a" }], "이 코드 리팩터링 해줘"), false);
});
