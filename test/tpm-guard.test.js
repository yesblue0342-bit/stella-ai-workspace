// TPM(분당 토큰) 가드 테스트 — Drive 링크+첨부로 요청이 41K 토큰까지 불어
// OpenAI 429 "Request too large"(조직 TPM 30K)가 나던 버그의 회귀 방지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trimHistoryByChars, isTpmError } from "../api/chat.js";

test("trimHistoryByChars: 최근 우선으로 문자 총량 제한", () => {
  const h = [
    { role: "user", content: "a".repeat(10000) },
    { role: "assistant", content: "b".repeat(10000) },
    { role: "user", content: "c".repeat(10000) },
  ];
  const out = trimHistoryByChars(h, 15000);
  assert.equal(out.length, 1, "최근 것부터 예산 내로");
  assert.ok(out[0].content.startsWith("c"), "가장 최근 메시지 유지");
  const out2 = trimHistoryByChars(h, 25000);
  assert.equal(out2.length, 2);
  assert.ok(out2[0].content.startsWith("b") && out2[1].content.startsWith("c"), "순서 보존");
});

test("trimHistoryByChars: 최소 1개(최신)는 예산 초과여도 유지", () => {
  const h = [{ role: "user", content: "x".repeat(50000) }];
  assert.equal(trimHistoryByChars(h, 1000).length, 1);
});

test("trimHistoryByChars: 빈/비배열 안전", () => {
  assert.deepEqual(trimHistoryByChars([], 1000), []);
  assert.deepEqual(trimHistoryByChars(null, 1000), []);
});

test("isTpmError: 실제 429 메시지 판별(스샷의 오류 그대로)", () => {
  assert.equal(isTpmError(new Error('OpenAI 429: {"error":{"message":"Request too large for gpt-4o in organization org-x on tokens per min (TPM): Limit 30000, Requested 41711."}}')), true);
  assert.equal(isTpmError(new Error("Rate limit reached")), true);
  assert.equal(isTpmError(new Error("OpenAI 500: internal error")), false);
  assert.equal(isTpmError(new Error("OPENAI_API_KEY not configured")), false);
  assert.equal(isTpmError(null), false);
});
