// lib/openai-tpm.mjs 단위 테스트 — OpenAI 429/TPM 방어 유틸(순수 함수). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens, estimateMessagesTokens, isRateLimitError, parseRetryAfterMs,
  computeBackoffMs, withRateLimitRetry, TpmBudget, safeMaxTokens, shouldChunk,
  downgradeModel, isDowngradable, friendlyRateLimitMessage,
} from "../lib/openai-tpm.mjs";

test("estimateTokens: 빈/영문/한글 근사", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens("abcd"), 1);          // 4자/토큰
  assert.equal(estimateTokens("a".repeat(400)), 100);
  // 한글은 더 촘촘하게(과소추정 방지) — 같은 길이여도 토큰이 더 많아야 한다.
  assert.ok(estimateTokens("가".repeat(100)) > estimateTokens("a".repeat(100)));
});

test("estimateMessagesTokens: 문자열/멀티모달/오버헤드", () => {
  const t = estimateMessagesTokens([
    { role: "system", content: "a".repeat(40) },   // 10
    { role: "user", content: "b".repeat(40) },      // 10
  ]);
  assert.ok(t >= 20 && t <= 40, "합산+오버헤드 범위: " + t);
  const withImg = estimateMessagesTokens([
    { role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: {} }] },
  ]);
  assert.ok(withImg > 800, "이미지 블록 비용 반영");
});

test("isRateLimitError: 429/문구/상태코드 판별", () => {
  assert.equal(isRateLimitError(new Error('Rate limit reached for gpt-4.1 ... tokens per min (TPM): Limit 30000')), true);
  assert.equal(isRateLimitError(Object.assign(new Error("x"), { status: 429 })), true);
  assert.equal(isRateLimitError(new Error("Request too large for gpt-4o")), true);
  assert.equal(isRateLimitError(new Error("OpenAI 500: internal error")), false);
  assert.equal(isRateLimitError(new Error("OPENAI_API_KEY not configured")), false);
  assert.equal(isRateLimitError(null), false);
});

test("parseRetryAfterMs: 헤더 > 메시지 파싱 > null", () => {
  // 1) Retry-After 헤더(초)
  assert.equal(parseRetryAfterMs(new Error("x"), { "retry-after": "3" }), 3000);
  // Headers-like(get)
  assert.equal(parseRetryAfterMs(new Error("x"), { get: (k) => (k === "retry-after" ? "2" : null) }), 2000);
  // 2) 메시지의 "try again in 4.232s"
  assert.equal(parseRetryAfterMs(new Error("Please try again in 4.232s.")), 4232);
  assert.equal(parseRetryAfterMs(new Error("try again in 200ms")), 200);
  // err.headers 폴백
  assert.equal(parseRetryAfterMs(Object.assign(new Error("x"), { headers: { "retry-after": "5" } })), 5000);
  // 3) 없음
  assert.equal(parseRetryAfterMs(new Error("no hint here")), null);
});

test("computeBackoffMs: Retry-After 우선, 없으면 지수, capMs 상한", () => {
  const noJit = { rand: () => 0 };
  // Retry-After 우선
  assert.equal(computeBackoffMs(0, { retryAfterMs: 4232, ...noJit }), 4232);
  // 지수: base 1000 * 2^attempt
  assert.equal(computeBackoffMs(0, noJit), 1000);
  assert.equal(computeBackoffMs(1, noJit), 2000);
  assert.equal(computeBackoffMs(3, noJit), 8000);
  // 상한
  assert.equal(computeBackoffMs(20, noJit), 60000);
  assert.equal(computeBackoffMs(0, { retryAfterMs: 999999, capMs: 60000, ...noJit }), 60000);
});

test("withRateLimitRetry: 429는 재시도 후 성공, 비-429는 즉시 throw", async () => {
  let n = 0;
  const waits = [];
  const out = await withRateLimitRetry(async () => {
    n++;
    if (n < 3) throw Object.assign(new Error("Rate limit reached, try again in 0s"), { status: 429 });
    return "ok";
  }, { sleep: async (ms) => waits.push(ms), rand: () => 0 });
  assert.equal(out, "ok");
  assert.equal(n, 3);
  assert.equal(waits.length, 2, "두 번 재시도");

  // 비-429는 재시도하지 않음
  let m = 0;
  await assert.rejects(
    () => withRateLimitRetry(async () => { m++; throw new Error("boom 500"); }, { sleep: async () => {} }),
    /boom 500/
  );
  assert.equal(m, 1);
});

test("withRateLimitRetry: 재시도 소진 시 마지막 에러 throw + onRetry 콜백", async () => {
  const events = [];
  await assert.rejects(
    () => withRateLimitRetry(
      async () => { throw Object.assign(new Error("429 tokens per min"), { status: 429 }); },
      { maxRetries: 2, sleep: async () => {}, rand: () => 0, onRetry: (e) => events.push(e.attempt) }
    ),
    /tokens per min/
  );
  assert.deepEqual(events, [1, 2], "maxRetries=2 → 2번 재시도 후 포기");
});

test("TpmBudget: 윈도우 누적/소거/선제 대기 계산", () => {
  const b = new TpmBudget({ limit: 30000, windowMs: 60000, safety: 1 }); // safety=1로 계산 단순화
  b.record(10000, 1000);
  b.record(10000, 2000);
  assert.equal(b.usedInWindow(3000), 20000);
  // 여유 있으면 대기 0
  assert.equal(b.waitMsFor(5000, 3000), 0);
  // 20000 사용 중 + 15000 요청 = 35000 > 30000 → 첫 이벤트(t=1000)가 빠질 때까지 대기
  // 첫 이벤트 만료 = 1000+60000 = 61000, now=3000 → 58000ms 대기하면 used=10000, +15000=25000 ok
  assert.equal(b.waitMsFor(15000, 3000), 58000);
  // 60초 지나면 소거되어 used=0
  assert.equal(b.usedInWindow(70000), 0);
});

test("TpmBudget: 단일 요청이 예산보다 크면 대기 0(청킹 신호)", () => {
  const b = new TpmBudget({ limit: 30000, safety: 0.85 });
  assert.equal(b.waitMsFor(30000, 0), 0); // cap=25500 < 30000 → 대기로 해결 불가
});

test("safeMaxTokens: 입력이 커지면 출력 상한이 조여진다", () => {
  assert.equal(safeMaxTokens(1000, { limit: 30000, safety: 0.85, desired: 4096, floor: 512 }), 4096);
  // 입력 24000 → cap 25500 - 24000 = 1500 → min(4096,1500)=1500
  assert.equal(safeMaxTokens(24000, { limit: 30000, safety: 0.85, desired: 4096, floor: 512 }), 1500);
  // 입력이 예산에 근접 → floor
  assert.equal(safeMaxTokens(25500, { limit: 30000, safety: 0.85, floor: 512 }), 512);
});

test("shouldChunk: 안전마진(60%) 초과 시 true", () => {
  assert.equal(shouldChunk(16458, { limit: 30000 }), false); // 16458+512=16970 < 18000 → 재시도로 해결
  assert.equal(shouldChunk(25000, { limit: 30000 }), true);  // 청킹 필요
});

test("downgradeModel / isDowngradable", () => {
  assert.equal(downgradeModel("gpt-4.1"), "gpt-4.1-mini");
  assert.equal(downgradeModel("gpt-4o"), "gpt-4o-mini");
  assert.equal(downgradeModel("gpt-4.1-mini"), "gpt-4.1-mini"); // 이미 최하위
  assert.equal(isDowngradable("gpt-4.1"), true);
  assert.equal(isDowngradable("gpt-4.1-mini"), false);
  assert.equal(isDowngradable(""), false);
});

test("friendlyRateLimitMessage: raw 429 미노출 + 재시도 안내", () => {
  const m = friendlyRateLimitMessage(new Error("Please try again in 4.2s"));
  assert.ok(!/429|TPM|tokens per min/i.test(m), "raw 에러 문구 미포함");
  assert.match(m, /다시 시도|나눠/);
});
