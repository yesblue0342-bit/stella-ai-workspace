// lib/openai-tpm.mjs — OpenAI Rate Limit(429 / TPM) 방어 유틸 (순수·무의존, node --test 검증 가능).
//
// 배경: OpenAI 조직이 Tier 1이면 gpt-4.1 TPM(tokens per min) 한도 = 30,000.
// 대용량 ABAP 소스 분석 시 단일 요청 토큰 + 롤링 60초 누적이 한도를 넘어 429가 났다.
// 이 모듈은 (1) 429 판별 (2) Retry-After/backoff 계산 (3) 재시도 래퍼 (4) 토큰 사전 추정
// (5) 롤링 TPM 예산 트래커 (6) 모델 다운그레이드 폴백 을 순수 함수로 제공한다.
// 실제 fetch/네트워크는 호출부(api/chat.js, api/codex/agent.js)가 주입한다 — 그래서 단위 테스트가 가능하다.

// ───────── 토큰 사전 추정 (tiktoken 없이 char/4 근사) ─────────
// tiktoken을 의존성으로 추가하지 않는다(경량 유지). char/4는 영문/코드에서 실측과 ±15% 내외로
// TPM 가드(안전마진 목적)엔 충분하다. 한국어는 토큰이 더 많으므로 보수적으로 살짝 올려 잡는다.
export function estimateTokens(text) {
  const s = String(text == null ? "" : text);
  if (!s) return 0;
  // ASCII 외(한글 등) 비율이 높으면 토큰 밀도가 높음 → 계수 상향(과소추정 방지).
  let nonAscii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) nonAscii++;
  const ratio = nonAscii / s.length;
  const divisor = ratio > 0.3 ? 2.5 : 4; // 한글 위주면 ~2.5자/토큰, 영문/코드면 ~4자/토큰
  return Math.ceil(s.length / divisor);
}

// Chat Completions messages 배열의 총 입력 토큰 근사(메시지당 포맷 오버헤드 포함).
export function estimateMessagesTokens(messages) {
  let sum = 0;
  for (const m of (Array.isArray(messages) ? messages : [])) {
    const c = m && m.content;
    if (typeof c === "string") {
      sum += estimateTokens(c);
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part.text === "string") sum += estimateTokens(part.text);
        else if (part && (part.image_url || part.type === "input_image" || part.type === "image_url")) sum += 800; // 이미지 대략치
      }
    }
    sum += 4; // role/구분자 오버헤드
  }
  return sum + 2;
}

// ───────── 429 / TPM 에러 판별 ─────────
export function isRateLimitError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err.code;
  if (status === 429 || status === "429") return true;
  const m = String((err && err.message) || err || "");
  return /\b429\b|tokens per min|\bTPM\b|Request too large|rate[ _-]?limit/i.test(m);
}

// ───────── 대기시간 결정: Retry-After 헤더 → 메시지의 "try again in Xs" → null ─────────
export function parseRetryAfterMs(err, headers) {
  // 1) 명시적 Retry-After 헤더 (초 단위 정수 또는 HTTP-date)
  let h = null;
  if (headers) {
    if (typeof headers.get === "function") h = headers.get("retry-after");
    else h = headers["retry-after"] != null ? headers["retry-after"] : headers["Retry-After"];
  }
  if (h == null && err && err.headers) {
    const eh = err.headers;
    if (typeof eh.get === "function") h = eh.get("retry-after");
    else h = eh["retry-after"] != null ? eh["retry-after"] : eh["Retry-After"];
  }
  if (h != null && h !== "") {
    const n = Number(h);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n * 1000));
    const d = Date.parse(h);
    if (Number.isFinite(d)) return Math.max(0, d - Date.now());
  }
  // 2) 에러 메시지의 "Please try again in 4.232s" / "try again in 200ms"
  const msg = String((err && err.message) || err || "");
  let mm = msg.match(/try again in\s+([\d.]+)\s*ms\b/i);
  if (mm) return Math.max(0, Math.round(Number(mm[1])));
  mm = msg.match(/try again in\s+([\d.]+)\s*s\b/i);
  if (mm) return Math.max(0, Math.round(Number(mm[1]) * 1000));
  return null; // 3) 호출부가 지수 백오프로 폴백
}

// ───────── 백오프 계산: Retry-After 우선, 없으면 2^attempt + jitter, 상한 capMs ─────────
export function computeBackoffMs(attempt, opts = {}) {
  const { retryAfterMs = null, capMs = 60000, baseMs = 1000, rand = Math.random } = opts;
  if (retryAfterMs != null && Number.isFinite(retryAfterMs)) {
    // Retry-After에 약간의 jitter를 더해 동시 재시도(thundering herd) 완화.
    return Math.min(capMs, Math.max(0, retryAfterMs) + Math.floor(rand() * 400));
  }
  const exp = baseMs * Math.pow(2, Math.max(0, attempt)); // attempt 0 → base, 1 → 2×, 2 → 4× …
  const jitter = Math.floor(rand() * 1000);
  return Math.min(capMs, exp + jitter);
}

// ───────── 재시도 래퍼 (429일 때만 재시도, 그 외 즉시 throw) ─────────
// fn(attempt) => Promise<result>. attempt는 0부터. 최대 maxRetries회 추가 재시도.
// 실패한 요청도 분당 한도에 카운트되므로 tight loop 금지(반드시 대기 후 재시도).
export async function withRateLimitRetry(fn, opts = {}) {
  const {
    maxRetries = 6, capMs = 60000, baseMs = 1000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    onRetry = null, rand = Math.random,
  } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const retryAfterMs = parseRetryAfterMs(err, err && err.headers);
      const waitMs = computeBackoffMs(attempt, { retryAfterMs, capMs, baseMs, rand });
      if (typeof onRetry === "function") {
        try { onRetry({ attempt: attempt + 1, maxRetries, waitMs, retryAfterMs, error: err }); } catch (_) {}
      }
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

// ───────── 롤링 TPM 예산 트래커 (최근 60초 소비 토큰 추적, 선제 대기) ─────────
// 프로세스 단위 in-memory. OpenAI TPM은 조직 전체 기준이므로 서버 전역 공유가 오히려 정확하다.
export class TpmBudget {
  constructor(opts = {}) {
    const { limit = 30000, windowMs = 60000, safety = 0.85 } = opts;
    this.limit = limit;
    this.windowMs = windowMs;
    this.safety = safety;      // 안전계수(예산의 85%까지만 사용)
    this.events = [];          // [{ t, tokens }] 시간순
  }
  _evict(now) {
    const cutoff = now - this.windowMs;
    while (this.events.length && this.events[0].t <= cutoff) this.events.shift();
  }
  usedInWindow(now = Date.now()) {
    this._evict(now);
    let s = 0;
    for (const e of this.events) s += e.tokens;
    return s;
  }
  record(tokens, now = Date.now()) {
    this._evict(now);
    this.events.push({ t: now, tokens: Math.max(0, Math.round(tokens) || 0) });
  }
  cap() { return Math.floor(this.limit * this.safety); }
  // `tokens` 요청이 안전예산에 들어올 때까지 필요한 대기(ms). 0이면 즉시 가능.
  // 단일 요청이 예산보다 크면 0 반환(대기로 해결 불가 → 호출부가 청킹/다운그레이드).
  waitMsFor(tokens, now = Date.now()) {
    const cap = this.cap();
    const need = Math.max(0, Math.round(tokens) || 0);
    if (need >= cap) return 0;
    this._evict(now);
    let used = 0;
    for (const e of this.events) used += e.tokens;
    if (used + need <= cap) return 0;
    // 오래된 이벤트가 윈도우에서 빠지는 순서대로, 언제 need가 들어올 수 있는지 계산.
    let remaining = used;
    for (const e of this.events) {
      remaining -= e.tokens;
      if (remaining + need <= cap) return Math.max(0, (e.t + this.windowMs) - now);
    }
    return 0;
  }
}

// ───────── 안전 max_tokens 계산 (TPM은 입력+출력 합산으로 과금) ─────────
// 추정 입력 + max_tokens 가 안전예산을 넘지 않도록 출력 상한을 조인다.
export function safeMaxTokens(estimatedInputTokens, opts = {}) {
  const { limit = 30000, safety = 0.85, desired = 4096, floor = 512 } = opts;
  const cap = Math.floor(limit * safety);
  const room = cap - Math.max(0, Math.round(estimatedInputTokens) || 0);
  if (room <= floor) return floor;                 // 입력이 이미 큼 → 최소 출력만(그리고 호출부는 청킹)
  return Math.max(floor, Math.min(desired, room));
}

// ───────── 청킹 필요 판별 (추정입력 + 최소출력 > 안전마진) ─────────
export function shouldChunk(estimatedInputTokens, opts = {}) {
  const { limit = 30000, marginRatio = 0.6, minOutput = 512 } = opts;
  const margin = Math.floor(limit * marginRatio);
  return (Math.max(0, Math.round(estimatedInputTokens) || 0) + minOutput) > margin;
}

// ───────── 모델 다운그레이드 / 폴백 라우팅 ─────────
// 429가 반복되거나 소스가 매우 큰 경우, TPM 한도가 훨씬 넉넉한 mini 계열로 자동 하향.
const DOWNGRADE = {
  "gpt-4.1": "gpt-4.1-mini",
  "gpt-4o": "gpt-4o-mini",
  "gpt-5.5-pro": "gpt-4.1-mini",
  "gpt-5.5": "gpt-4.1-mini",
  "gpt-5": "gpt-4o-mini",
};
export function downgradeModel(model) {
  const m = String(model || "").toLowerCase().trim();
  if (DOWNGRADE[m]) return DOWNGRADE[m];
  if (m.includes("mini")) return m;            // 이미 최하위 계열
  if (m.includes("4.1")) return "gpt-4.1-mini";
  if (m.includes("4o")) return "gpt-4o-mini";
  return "gpt-4.1-mini";
}
export function isDowngradable(model) {
  const m = String(model || "").toLowerCase().trim();
  return !!m && downgradeModel(m) !== m;
}

// ───────── 사용자 친화 에러 메시지 (raw 429 노출 금지) ─────────
export function friendlyRateLimitMessage(err) {
  const retryMs = parseRetryAfterMs(err, err && err.headers);
  const sec = retryMs ? Math.ceil(retryMs / 1000) : null;
  return "지금 AI 사용량이 몰려 잠시 요청이 지연되고 있습니다"
    + (sec ? ` (약 ${sec}초 후 여유)` : "")
    + ". 자동 재시도로도 해결되지 않았습니다 — 잠시 후 다시 시도하거나, 소스를 나눠서 분석해 주세요.";
}

export default {
  estimateTokens, estimateMessagesTokens, isRateLimitError, parseRetryAfterMs,
  computeBackoffMs, withRateLimitRetry, TpmBudget, safeMaxTokens, shouldChunk,
  downgradeModel, isDowngradable, friendlyRateLimitMessage,
};
