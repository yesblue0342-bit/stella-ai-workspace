// lib/chat/openai-client.mjs · claude-client.mjs — 모델 별칭 해석과 청킹 게이트 테스트.
// 모델 패밀리별 빌링 분리(Claude 선택 시 OpenAI 미호출)의 판정 함수가 핵심.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpenAIModel, estimateRequestTokens, needsChunking, OPENAI_TPM_LIMIT } from "../lib/chat/openai-client.mjs";
import { resolveClaudeModel, isClaudeModelName } from "../lib/chat/claude-client.mjs";
import { shouldChunkAbap } from "../lib/chat/abap-analyze.mjs";

test("resolveOpenAIModel: 별칭 → 실제 모델 ID, 미지값은 gpt-4o", () => {
  assert.equal(resolveOpenAIModel("chatgpt-5.5-latest"), "gpt-4o");
  assert.equal(resolveOpenAIModel("gpt-5"), "gpt-4o");
  assert.equal(resolveOpenAIModel("gpt-4.1-mini"), "gpt-4.1-mini");
  assert.equal(resolveOpenAIModel("GPT-4O-MINI"), "gpt-4o-mini");
  assert.equal(resolveOpenAIModel(""), "gpt-4o");
  assert.equal(resolveOpenAIModel(undefined), "gpt-4o");
});

test("resolveClaudeModel: 패밀리/버전 별칭 해석", () => {
  assert.equal(resolveClaudeModel("claude-opus-4-8"), "claude-opus-4-8");
  assert.equal(resolveClaudeModel("opus 4.7"), "claude-opus-4-7");
  assert.equal(resolveClaudeModel("opus"), "claude-opus-4-8", "버전 미지정 opus는 최신");
  assert.equal(resolveClaudeModel("fable"), "claude-fable-5");
  assert.equal(resolveClaudeModel("haiku"), "claude-haiku-4-5-20251001");
  assert.equal(resolveClaudeModel("아무거나"), "claude-sonnet-4-6");
});

test("isClaudeModelName: claude/fable 계열만 true (빌링 분리 게이트)", () => {
  assert.equal(isClaudeModelName("claude-sonnet-4-6"), true);
  assert.equal(isClaudeModelName("claude-fable-5"), true);
  assert.equal(isClaudeModelName("Fable"), true);
  assert.equal(isClaudeModelName("gpt-4o"), false);
  assert.equal(isClaudeModelName(""), false);
});

test("estimateRequestTokens: 한글은 토큰 밀도를 높게 잡는다", () => {
  const ascii = estimateRequestTokens({ system: "a".repeat(100), message: "", history: [] });
  const hangul = estimateRequestTokens({ system: "가".repeat(100), message: "", history: [] });
  assert.ok(hangul > ascii, "한글이 더 많은 토큰으로 추정되어야 과소추정을 막는다");
  assert.equal(estimateRequestTokens({ system: "", message: "", history: null }), 0);
});

test("estimateRequestTokens: 히스토리 content 를 합산", () => {
  const withHistory = estimateRequestTokens({ system: "", message: "", history: [{ content: "x".repeat(400) }, { content: "y".repeat(400) }] });
  assert.equal(withHistory, 200); // 800자 / 4
});

test("needsChunking: TPM 안전마진(60%)을 넘으면 청킹", () => {
  assert.equal(needsChunking(0), false);
  assert.equal(needsChunking(OPENAI_TPM_LIMIT), true);
});

test("shouldChunkAbap: 큰 입력 + ABAP 코드 + Drive 질의 아님, 셋 다일 때만", () => {
  // 안전마진(TPM 60%) 을 확실히 넘기는 크기 + ABAP 시그널 3종 이상
  const abap = "REPORT zqm_test.\nDATA: lv_x TYPE i.\nSELECT * FROM mara INTO TABLE lt_mara.\nLOOP AT lt_mara.\nENDLOOP.\nWRITE: / lv_x.\n".repeat(1000);
  assert.equal(shouldChunkAbap({ system: "s", message: abap, history: [], isDriveQuery: false }).use, true);
  assert.equal(shouldChunkAbap({ system: "s", message: abap, history: [], isDriveQuery: true }).use, false, "Drive 문서 Q&A는 조각내지 않는다");
  assert.equal(shouldChunkAbap({ system: "s", message: "짧은 질문", history: [], isDriveQuery: false }).use, false);
  // ABAP이 아닌 대용량 산문은 청킹하지 않는다(답이 깨짐)
  assert.equal(shouldChunkAbap({ system: "s", message: "가".repeat(60000), history: [], isDriveQuery: false }).use, false);
});
