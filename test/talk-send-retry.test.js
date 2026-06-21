// A2: Stella Talk 전송 재시도 정책 — 실제 talk.html 소스에서 함수 추출해 검증 + 재시도 루프 시뮬레이션.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "talk.html"), "utf8");

// 실제 소스에서 정책 함수 추출
const srcIsRetry = html.match(/function isRetryableStatus\(s\)\{[^}]*\}/)[0];
const srcBackoff = html.match(/function sendBackoffMs\(attempt\)\{[^}]*\}/)[0];
const SEND_MAX_RETRY = Number((html.match(/var SEND_MAX_RETRY = (\d+)/) || [])[1]);
// eslint-disable-next-line no-eval
const isRetryableStatus = eval("(" + srcIsRetry + ")");
// eslint-disable-next-line no-eval
const sendBackoffMs = eval("(" + srcBackoff + ")");

test("isRetryableStatus: 네트워크(0)/타임아웃(408,504)/과부하(429)/5xx만 재시도", () => {
  for (const s of [0, 408, 429, 500, 502, 503, 504]) assert.equal(isRetryableStatus(s), true, "retry " + s);
  for (const s of [-1, 200, 400, 401, 403, 409]) assert.equal(isRetryableStatus(s), false, "no-retry " + s);
});

test("sendBackoffMs: 지수 백오프 1s,2s,4s,8s 상한", () => {
  assert.equal(sendBackoffMs(0), 1000);
  assert.equal(sendBackoffMs(1), 2000);
  assert.equal(sendBackoffMs(2), 4000);
  assert.equal(sendBackoffMs(3), 8000);
  assert.equal(sendBackoffMs(9), 8000); // cap
});

test("SEND_MAX_RETRY = 3", () => assert.equal(SEND_MAX_RETRY, 3));

// 실제 catch 로직과 동일한 재시도 루프 시뮬레이션
function simulate(statusSeq) {
  let attempt = 0;
  while (true) {
    const st = statusSeq[Math.min(attempt, statusSeq.length - 1)];
    if (st === 200) return { state: "sent", sends: attempt + 1 };
    if (isRetryableStatus(st) && attempt < SEND_MAX_RETRY) { attempt++; continue; }
    return { state: "failed", sends: attempt + 1 };
  }
}

test("일시 오류(503) 지속 → 백오프 재시도 소진 후에만 'failed'(재전송 표시)", () => {
  const r = simulate([503]);
  assert.equal(r.state, "failed");
  assert.equal(r.sends, 4); // attempt 0,1,2 재시도 → 3에서 중단 = 총 4회 전송
});

test("일시 끊김 후 복구(0,0,성공) → 'sent', 수동 재전송 불필요", () => {
  const r = simulate([0, 0, 200]);
  assert.equal(r.state, "sent");
  assert.equal(r.sends, 3);
});

test("인증/권한(401)·앱거절(-1) → 재시도 없이 즉시 'failed'", () => {
  assert.deepEqual(simulate([401]), { state: "failed", sends: 1 });
  assert.deepEqual(simulate([-1]), { state: "failed", sends: 1 });
});

test("첫 시도 성공 → 'sent', 1회", () => {
  assert.deepEqual(simulate([200]), { state: "sent", sends: 1 });
});
