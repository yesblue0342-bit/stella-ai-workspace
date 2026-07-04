// lib/openai-pricing.mjs 단위 테스트 — Stella Codex 비용 표시(대략 추정치) 계산 검증.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateOpenAiCostUsd } from "../lib/openai-pricing.mjs";

test("알려진 모델: prompt/completion 토큰으로 비용 계산", () => {
  const cost = estimateOpenAiCostUsd("gpt-4o-mini", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
  assert.equal(cost, 0.15 + 0.6);
});

test("usage 없음(null/undefined) → 0", () => {
  assert.equal(estimateOpenAiCostUsd("gpt-4o", null), 0);
  assert.equal(estimateOpenAiCostUsd("gpt-4o", undefined), 0);
});

test("모르는 모델은 gpt-4.1-mini 단가로 폴백(크래시하지 않음)", () => {
  const known = estimateOpenAiCostUsd("gpt-4.1-mini", { prompt_tokens: 500_000, completion_tokens: 0 });
  const unknown = estimateOpenAiCostUsd("some-future-model", { prompt_tokens: 500_000, completion_tokens: 0 });
  assert.equal(unknown, known);
});

test("input_tokens/output_tokens(대체 키 이름)도 인식", () => {
  const cost = estimateOpenAiCostUsd("gpt-4.1", { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(cost, 2);
});
