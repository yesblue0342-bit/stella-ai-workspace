// lib/retry.js 단위 테스트 — 콜드 스타트 재시도 로직 (실행: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../lib/retry.js";

test("성공하면 즉시 반환, 재시도 없음", async () => {
  let calls = 0;
  const out = await withRetry(async () => { calls++; return "ok"; }, { retries: 3, baseDelay: 1 });
  assert.equal(out, "ok");
  assert.equal(calls, 1);
});

test("2회 실패 후 3번째 성공 → 값 반환 (총 3회 호출)", async () => {
  let calls = 0;
  const out = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error("cold start timeout");
    return "warmed";
  }, { retries: 3, baseDelay: 1 });
  assert.equal(out, "warmed");
  assert.equal(calls, 3);
});

test("모두 실패하면 마지막 에러 throw (정확히 retries회 호출)", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error("fail-" + calls); }, { retries: 3, baseDelay: 1 }),
    /fail-3/
  );
  assert.equal(calls, 3);
});

test("onRetry 콜백은 재시도 직전마다 호출 (성공 직전 2회)", async () => {
  let calls = 0, retried = 0;
  await withRetry(async () => { calls++; if (calls < 3) throw new Error("x"); return 1; },
    { retries: 5, baseDelay: 1, onRetry: () => { retried++; } });
  assert.equal(retried, 2); // 1차 실패→재시도, 2차 실패→재시도, 3차 성공
});

test("retries=1 이면 1회만 시도하고 throw", async () => {
  let calls = 0;
  await assert.rejects(() => withRetry(async () => { calls++; throw new Error("once"); }, { retries: 1, baseDelay: 1 }));
  assert.equal(calls, 1);
});
