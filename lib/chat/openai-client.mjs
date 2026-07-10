// lib/chat/openai-client.mjs — OpenAI 호출부(Responses API / Chat Completions) + TPM 방어.
// api/chat.js 분리의 일부. 429/TPM 재시도·롤링 예산·모델 다운그레이드는 lib/openai-tpm.mjs 순수 유틸에 위임.

import { extractText } from "../router.mjs";
import { visionImageBlock, ensureVisionModel, parseDataUrl } from "../vision-format.mjs";
import {
  estimateTokens, estimateMessagesTokens, isRateLimitError, withRateLimitRetry,
  TpmBudget, safeMaxTokens, shouldChunk, downgradeModel, isDowngradable,
  friendlyRateLimitMessage,
} from "../openai-tpm.mjs";

// ───────── OpenAI TPM 설정 (조직 한도; 티어 상승 시 env로 상향) ─────────
// Tier 1 gpt-4.1 TPM = 30,000. 배포 환경변수로 재정의 가능(코드 방어는 티어와 무관하게 유지).
export const OPENAI_TPM_LIMIT = Math.max(4000, Number(process.env.OPENAI_TPM_LIMIT) || 30000);
const OPENAI_MAX_RETRIES = Math.max(1, Number(process.env.OPENAI_MAX_RETRIES) || 6);
// 비용 절감: Responses API는 상한을 안 주면 모델 최대치(gpt-4o 16,384)까지 뽑는다.
// 실사용 답변은 8K 토큰을 거의 넘지 않으므로 상한을 걸고, 잘리면 이어쓰기를 안내한다(무음 절단 금지).
const OPENAI_MAX_OUTPUT_TOKENS = Math.max(512, Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 8192);

// gpt-4.1은 mini보다 TPM 한도가 낮다 → 롤링 예산은 gpt-4.1 기준으로 잡는다(가장 빡빡한 경계).
const tpmBudget = new TpmBudget({ limit: OPENAI_TPM_LIMIT, windowMs: 60000, safety: 0.85 });
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const TRUNCATED_NOTICE = "\n\n⚠️ 답변이 길이 제한으로 잘렸습니다. \"이어서 계속\"이라고 입력하면 이어서 작성합니다.";
// web_search는 응답이 길어질 수 있음 → 290초 상한으로 무한 대기/좀비 연결 방지.
const RESPONSES_TIMEOUT_MS = 290000;

/** data URL 문자열만 남긴다(비전 블록 생성 대상). */
function dataUrlImages(images) {
  return (Array.isArray(images) ? images : []).filter((u) => u && String(u).startsWith("data:"));
}

// callResponses / streamResponses 공통 요청 본문. 두 함수가 같은 20여 줄을 중복하고 있었다.
function buildResponsesBody({ model, system, history, message, images, search, stream }) {
  const input = [];
  for (const m of (Array.isArray(history) ? history : []).slice(-12)) {
    input.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") });
  }
  const imgs = dataUrlImages(images);
  if (imgs.length) {
    // Responses API 정확한 이미지 블록(input_image + 문자열 image_url). 공유 util로 포맷 일치 보장.
    const blocks = imgs.map((u) => { const { base64, mediaType } = parseDataUrl(u); return visionImageBlock({ api: "responses", base64, mediaType }); });
    input.push({ role: "user", content: [{ type: "input_text", text: String(message || "") }, ...blocks] });
  } else {
    input.push({ role: "user", content: String(message || "") });
  }
  // 이미지가 있으면 비전 가능 모델 보장(텍스트전용이면 gpt-4o로 교체).
  const body = {
    model: ensureVisionModel(model, imgs.length > 0, "openai"),
    instructions: system,
    input,
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
  };
  // ★ 직접 비전 우선: 이미지가 있으면 web_search 툴을 붙이지 않는다(툴 흐름으로 빠져 거부/빈응답 → OCR 폴백되는 문제 차단).
  if (search && !imgs.length) body.tools = [{ type: "web_search" }];
  if (stream) body.stream = true;
  return body;
}

async function postResponses(body, signal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * OpenAI Responses API + web_search 호출 (실시간 질문). 응답 contract(text)는 호출부에서 유지.
 * @returns {Promise<string>} 답변 텍스트
 */
export async function callResponses({ model, system, history, message, images = [], search = false }) {
  const body = buildResponsesBody({ model, system, history, message, images, search, stream: false });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RESPONSES_TIMEOUT_MS);
  try {
    const r = await postResponses(body, ctrl.signal);
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const data = await r.json();
    const text = extractText(data);
    // max_output_tokens로 잘린 응답을 완결처럼 반환하지 않는다.
    const truncated = data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens";
    return truncated ? text + TRUNCATED_NOTICE : text;
  } finally { clearTimeout(timer); }
}

/**
 * OpenAI Responses API 스트리밍(SSE). onDelta(텍스트조각) 콜백으로 점진 전달, 최종 누적문자열 반환.
 * 실패 시 throw → 호출부(핸들러)가 SSE error 이벤트 전송, 클라는 비스트리밍으로 폴백.
 * @returns {Promise<string>} 누적 텍스트
 */
export async function streamResponses({ model, system, history, message, images = [], search = false, onDelta }) {
  const body = buildResponsesBody({ model, system, history, message, images, search, stream: true });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RESPONSES_TIMEOUT_MS);
  let full = "";
  try {
    const r = await postResponses(body, ctrl.signal);
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    if (!r.body) throw new Error("no stream body");
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const ev = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const dl = ev.split("\n").find((l) => l.startsWith("data:"));
        if (!dl) continue;
        const js = dl.slice(5).trim();
        if (!js || js === "[DONE]") continue;
        let o; try { o = JSON.parse(js); } catch { continue; }
        if (o.type === "response.output_text.delta" && typeof o.delta === "string") {
          full += o.delta; if (onDelta) onDelta(o.delta);
        } else if (o.type === "response.incomplete") {
          full += TRUNCATED_NOTICE; if (onDelta) onDelta(TRUNCATED_NOTICE);
        } else if (o.type === "response.error" || o.error) {
          throw new Error((o.error && o.error.message) || "stream error");
        }
      }
    }
    return full;
  } finally { clearTimeout(timer); }
}

/** UI가 보내는 모델 별칭을 실제 OpenAI 모델 ID로 정규화. */
export function resolveOpenAIModel(model) {
  const m = String(model || "").toLowerCase().trim();
  if (m.includes("5.5") || m === "chatgpt-5.5-latest") return "gpt-4o";
  if (m === "gpt-5") return "gpt-4o";
  if (m === "gpt-4.1") return "gpt-4.1";
  if (m === "gpt-4.1-mini") return "gpt-4.1-mini";
  if (m === "gpt-4o") return "gpt-4o";
  if (m === "gpt-4o-mini") return "gpt-4o-mini";
  return "gpt-4o";
}

/** 요청 하나의 입력 토큰 추정(프롬프트 + 메시지 + 히스토리). 청킹 게이트 판정용. */
export function estimateRequestTokens({ system, message, history }) {
  return estimateTokens(system) + estimateTokens(message)
    + (Array.isArray(history) ? history.reduce((a, m) => a + estimateTokens(m && m.content), 0) : 0);
}

/** 추정 입력이 TPM 안전마진(60%)을 넘어 청킹이 필요한가. */
export function needsChunking(estimatedInputTokens) {
  return shouldChunk(estimatedInputTokens, { limit: OPENAI_TPM_LIMIT });
}

/**
 * OpenAI Chat Completions 호출 (429 재시도 + 롤링 TPM 예산 + mini 다운그레이드 포함).
 * @returns {Promise<string | {text: string, usage: object|null, model: string}>} returnUsage=true 일 때만 객체.
 */
export async function callOpenAI({ model, system, history, message, images = [], bare = false, returnUsage = false, onRetry = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const imgs = dataUrlImages(images);
  // 이미지가 있으면 비전 가능 모델 보장(gpt-4.1-mini 등은 비전 지원이라 유지).
  const selectedModel = ensureVisionModel(resolveOpenAIModel(model), imgs.length > 0, "openai");
  // bare=true(예: Stella Codex 코딩 어시스턴트)는 "[표+요약]" 강제 형식 프리픽스를 생략
  const pfx = bare ? "" : "[표+요약 형식으로 답변] ";
  // ★ 정적 system 프롬프트를 항상 messages[0]에 고정 → OpenAI 자동 prompt caching 히트율 ↑(반복 토큰 절감).
  const messages = [
    { role: "system", content: system },
    ...(Array.isArray(history) ? history : []).slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
    { role: "user", content: imgs.length > 0
      ? [{ type: "text", text: pfx + String(message || "") },
         ...imgs.map((u) => { const { base64, mediaType } = parseDataUrl(u); const b = visionImageBlock({ api: "chat", base64, mediaType }); b.image_url.detail = "auto"; return b; })]
      : pfx + String(message || "") },
  ];

  // 입력 토큰 사전 추정. TPM은 입력+출력 합산 과금이므로, 예산이 빡빡할 때만 max_tokens(출력)를 조인다.
  // 예산에 여유가 충분하면 max_tokens를 붙이지 않아 기존 동작(긴 출력 완결)을 그대로 보존한다(회귀 방지).
  const estIn = estimateMessagesTokens(messages);
  const budgetRoom = tpmBudget.cap() - estIn;             // 안전예산에서 입력 뺀 출력 여유
  const CONSTRAIN_BELOW = 8192;                            // 여유가 이 미만일 때만 출력 상한 적용
  const maxTokens = budgetRoom < CONSTRAIN_BELOW
    ? safeMaxTokens(estIn, { limit: OPENAI_TPM_LIMIT, safety: 0.85, desired: 4096, floor: 512 })
    : null;                                                // null = max_tokens 미지정(기존 동작)
  const outBudget = maxTokens || 4096;                     // 롤링 예산 예측용 출력 근사
  // 입력만으로 gpt-4.1 예산에 근접하면 처음부터 mini로 시작(mini는 TPM 한도가 훨씬 넉넉).
  const startTooBig = needsChunking(estIn) && isDowngradable(selectedModel);

  const doCall = async (attempt) => {
    // 429가 2회 이상 반복되거나, 애초에 입력이 큰 경우 → mini로 다운그레이드(내용 보존, 자가 치유).
    const usedModel = ((attempt >= 2 || startTooBig) && isDowngradable(selectedModel))
      ? downgradeModel(selectedModel) : selectedModel;
    // 롤링 TPM 예산: 최근 60초 누적이 한도에 가까우면 오래된 토큰이 빠질 때까지 선제 대기(429 발생 전 회피).
    const waitMs = Math.min(30000, tpmBudget.waitMsFor(estIn + outBudget));
    if (waitMs > 0) await sleep(waitMs);

    const reqBody = { model: usedModel, temperature: 0.1, messages };
    if (maxTokens != null) reqBody.max_tokens = maxTokens;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(reqBody),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = new Error(data?.error?.message || `OpenAI API error ${response.status}`);
      e.status = response.status;
      e.headers = response.headers; // Retry-After 파싱용
      throw e;
    }
    // 실제 소비 토큰을 롤링 예산에 기록(다음 요청 throttle 정확도 ↑). usage 없으면 추정치로.
    tpmBudget.record((data.usage && data.usage.total_tokens) || (estIn + outBudget));
    let text = data.choices?.[0]?.message?.content || "응답 없음";
    // max_tokens로 잘린 경우(예산이 빡빡해 출력 상한을 건 상황)엔 완결처럼 반환하지 않고 이어쓰기 안내.
    if (maxTokens != null && data.choices?.[0]?.finish_reason === "length") {
      text += TRUNCATED_NOTICE;
    }
    return { text, usage: data.usage || null, model: usedModel };
  };

  let result;
  try {
    result = await withRateLimitRetry(doCall, {
      maxRetries: OPENAI_MAX_RETRIES, capMs: 60000, baseMs: 1000, sleep,
      onRetry: (info) => { try { onRetry && onRetry(info); } catch (_) {} },
    });
  } catch (e) {
    // raw 429는 사용자에게 노출하지 않는다 — 친화 메시지로 치환(핸들러 catch가 그대로 전달).
    if (isRateLimitError(e)) throw new Error(friendlyRateLimitMessage(e));
    throw e;
  }
  // returnUsage=true(Stella Codex 비용 표시용)일 때만 객체 반환 — 다른 호출부는 기존 문자열 반환 그대로(회귀 없음).
  if (returnUsage) return { text: result.text, usage: result.usage, model: result.model };
  return result.text;
}
