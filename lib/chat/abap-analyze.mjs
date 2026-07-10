// lib/chat/abap-analyze.mjs — 대용량 ABAP 소스를 청크로 나눠 분석하고 결과를 종합한다.
// api/chat.js 분리의 일부. 전체 라인 커버리지 + TPM(429) 방어를 동시에 만족시키는 경로.

import { chunkAbapSource, mergeAbapAnalyses, looksLikeAbap } from "../abap-chunk.mjs";
import { callOpenAI, OPENAI_TPM_LIMIT, estimateRequestTokens, needsChunking } from "./openai-client.mjs";

export { looksLikeAbap };

/**
 * 청킹 게이트: (1) 입력이 TPM 안전마진 초과 & (2) ABAP 코드성 텍스트 & (3) Drive 문서 Q&A 아님.
 * 일반 문서 Q&A를 조각내면 답이 깨지므로 게이트를 좁게 잡는다(회귀 방지).
 * @returns {{use: boolean, estimatedInputTokens: number}}
 */
export function shouldChunkAbap({ system, message, history, isDriveQuery }) {
  const estimatedInputTokens = estimateRequestTokens({ system, message, history });
  const use = !isDriveQuery && needsChunking(estimatedInputTokens) && looksLikeAbap(message);
  return { use, estimatedInputTokens };
}

/**
 * 대용량 ABAP 소스를 청크로 나누어 각 청크를 분석하고 결과를 종합한다.
 * 각 청크 호출은 callOpenAI 내부의 재시도·롤링예산·mini 폴백을 그대로 활용한다. images는 첫 청크에만 붙인다.
 * @param {{model: string, system: string, question: string, payload: string, images?: string[], onProgress?: (n: number, total: number) => void}} args
 * @returns {Promise<{text: string, chunks: number, usage: object, model: string}>}
 */
export async function analyzeAbapInChunks({ model, system, question, payload, images = [], onProgress = null }) {
  // 청크 입력 목표: 안전예산의 ~40%. 토큰→문자 근사(×3, 보수적) → 출력 여유 확보 + 롤링 윈도우 안전.
  const maxChars = Math.max(6000, Math.round(OPENAI_TPM_LIMIT * 0.40 * 3));
  const chunks = chunkAbapSource(payload, { maxChars });
  if (chunks.length <= 1) {
    const r = await callOpenAI({ model, system, history: [], message: payload, images, bare: true, returnUsage: true });
    return { text: r.text, chunks: 1, usage: r.usage, model: r.model };
  }

  const results = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let usedModel = model;
  for (const ch of chunks) {
    if (onProgress) { try { onProgress(ch.index + 1, chunks.length); } catch (_) {} }
    const chunkMsg =
      `[사용자 질문]\n${question || "이 ABAP 소스의 오류/경고/개선점을 분석하세요."}\n\n` +
      `[분석 대상 — 청크 ${ch.index + 1}/${chunks.length}, 라인 ${ch.startLine}–${ch.endLine}]\n` +
      "아래는 대용량 ABAP 소스의 일부입니다. 이 청크에 해당하는 부분만 분석해 " +
      "오류·경고·성능/개선점을 항목별(- 불릿)로 제시하세요. 다른 청크는 별도로 분석됩니다.\n\n" +
      "```abap\n" + ch.text + "\n```";
    const r = await callOpenAI({
      model, system, history: [], message: chunkMsg,
      images: ch.index === 0 ? images : [], bare: true, returnUsage: true,
    });
    usedModel = r.model || usedModel;
    results.push({ index: ch.index, total: chunks.length, startLine: ch.startLine, endLine: ch.endLine, text: r.text });
    if (r.usage) {
      usage.prompt_tokens += r.usage.prompt_tokens || 0;
      usage.completion_tokens += r.usage.completion_tokens || 0;
      usage.total_tokens += r.usage.total_tokens || 0;
    }
  }
  return { text: mergeAbapAnalyses(results), chunks: chunks.length, usage, model: usedModel };
}
