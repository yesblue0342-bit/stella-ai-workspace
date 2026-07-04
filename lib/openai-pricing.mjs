// lib/openai-pricing.mjs — OpenAI 모델 대략적 단가(USD/1M tokens) + 비용 추정.
// Anthropic 쪽 api/cc/_maclient.mjs의 PRICE/estimateCostUsd와 동일한 목적(예산 표시용 근사치,
// 정확한 청구 금액이 아님 — OpenAI 대시보드가 정확한 값).
const PRICE = {
  "gpt-5.5-pro": { in: 15, out: 60 },
  "gpt-5.5": { in: 5, out: 20 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

export function estimateOpenAiCostUsd(model, usage) {
  const p = PRICE[model] || PRICE["gpt-4.1-mini"];
  const u = usage || {};
  const inTok = u.prompt_tokens || u.input_tokens || 0;
  const outTok = u.completion_tokens || u.output_tokens || 0;
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

export default { estimateOpenAiCostUsd };
