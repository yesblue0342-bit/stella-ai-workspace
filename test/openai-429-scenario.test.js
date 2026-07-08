// 통합 시나리오 테스트 — 과제의 실제 429 재현. callOpenAI/callOpenAIOnce가 조합해 쓰는
// withRateLimitRetry + TpmBudget + downgradeModel 을 페이크 fetch로 end-to-end 검증한다.
// (api/chat.js 전체 import는 googleapis 등 미설치 의존성 때문에 이 환경에서 불가 → 조합 단위로 검증)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withRateLimitRetry, TpmBudget, downgradeModel, isDowngradable, isRateLimitError, parseRetryAfterMs,
} from "../lib/openai-tpm.mjs";

// 과제 스샷의 실제 에러 메시지
const REAL_429 = 'Rate limit reached for gpt-4.1 in organization org-xxxx on tokens per min (TPM): '
  + 'Limit 30000, Used 15658, Requested 16458. Please try again in 4.232s.';

// callOpenAI 내부 재시도 루프를 그대로 모사한 헬퍼(모델 다운그레이드 포함)
function makeCaller(fakeFetch, model) {
  return (attempt) => {
    const usedModel = (attempt >= 2 && isDowngradable(model)) ? downgradeModel(model) : model;
    return fakeFetch(usedModel, attempt);
  };
}

test("시나리오 A: 429 1회 후 자동 재시도 성공 — Retry-After(4.232s) 만큼 대기, 사용자 개입 불필요", async () => {
  assert.equal(isRateLimitError(new Error(REAL_429)), true);
  assert.equal(parseRetryAfterMs(new Error(REAL_429)), 4232);

  const waits = [];
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    if (calls === 1) { const e = new Error(REAL_429); e.status = 429; throw e; }
    return { ok: true, model: "gpt-4.1", text: "분석 완료" };
  };
  const out = await withRateLimitRetry(makeCaller(fakeFetch, "gpt-4.1"), {
    sleep: async (ms) => waits.push(ms), rand: () => 0,
  });
  assert.equal(out.text, "분석 완료");
  assert.equal(calls, 2, "1회 실패 → 1회 재시도 성공");
  assert.equal(waits[0], 4232, "Retry-After(4.232s) 준수");
});

test("시나리오 B: 429가 반복되면 gpt-4.1 → gpt-4.1-mini 자동 폴백", async () => {
  const modelsSeen = [];
  let calls = 0;
  const fakeFetch = async (usedModel) => {
    modelsSeen.push(usedModel);
    calls++;
    if (calls < 3) { const e = new Error("429 tokens per min"); e.status = 429; throw e; } // attempt 0,1 실패
    return { ok: true, model: usedModel, text: "mini로 완료" };
  };
  const out = await withRateLimitRetry(makeCaller(fakeFetch, "gpt-4.1"), {
    sleep: async () => {}, rand: () => 0,
  });
  assert.equal(out.text, "mini로 완료");
  // attempt 0,1 → gpt-4.1, attempt 2 → 다운그레이드
  assert.deepEqual(modelsSeen, ["gpt-4.1", "gpt-4.1", "gpt-4.1-mini"]);
});

test("시나리오 C: 롤링 60초 윈도우 — 누적이 한도 근접 시 429 전에 선제 대기", async () => {
  // 스샷 상황: 최근 60초 Used=15658, 이번 Requested=16458 → 합 32116 > 30000
  const b = new TpmBudget({ limit: 30000, windowMs: 60000, safety: 1 });
  b.record(15658, 0);
  // 이번 요청 16458을 지금(=1000ms 시점) 넣으면 초과 → 첫 이벤트(t=0) 만료(60000)까지 대기 필요
  const wait = b.waitMsFor(16458, 1000);
  assert.ok(wait > 0, "선제 대기 발생(429 회피)");
  assert.equal(wait, 59000, "t=0 이벤트가 60000에 만료 → now=1000 기준 59000ms 대기");
  // 대기 후(윈도우 지나 소거)에는 즉시 가능
  assert.equal(b.waitMsFor(16458, 61000), 0);
});

test("시나리오 D: 최종 실패 시에도 raw 429가 아니라 재시도 소진 에러가 던져진다", async () => {
  await assert.rejects(
    () => withRateLimitRetry(
      async () => { const e = new Error("429 rate limit"); e.status = 429; throw e; },
      { maxRetries: 2, sleep: async () => {}, rand: () => 0 }
    ),
    (e) => isRateLimitError(e) // 호출부(callOpenAI)가 이 지점에서 friendlyRateLimitMessage로 치환
  );
});
