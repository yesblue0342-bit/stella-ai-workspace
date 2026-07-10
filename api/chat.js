// api/chat.js — Stella GPT / ABAP / Codex 공용 채팅 엔드포인트.
//
// 이 파일은 라우팅과 응답 조립만 담당한다. 실제 구현은 lib/chat/* 모듈에 있다:
//   intent.mjs        의도 감지(Drive/GitHub) + 히스토리 트리밍 (순수)
//   system-prompt.mjs 시스템 프롬프트 조립 (순수)
//   weather.mjs       날씨 직접 응답(Open-Meteo, 캐시)
//   github-actions.mjs 레포 self-call 액션
//   context.mjs       실시간 검색 / Drive 컨텍스트 준비
//   memory.mjs        장기 메모리 로드·추출·저장
//   openai-client.mjs OpenAI Responses / Chat Completions + TPM 방어
//   claude-client.mjs Anthropic Messages
//   abap-analyze.mjs  대용량 ABAP 청킹 분석

import { getAuthUser } from "../lib/session.js";
import { wantsTable, buildSystemPrompt as routeSystemPrompt } from "../lib/router.mjs";
import { estimateOpenAiCostUsd } from "../lib/openai-pricing.mjs";

import {
  trimHistoryByChars, isTpmError, detectDriveIntent, detectGitHubIntent,
  isWeatherQuery, needsRealtimeSearch, needsWeatherContext, needsSapDriveSearch,
} from "../lib/chat/intent.mjs";
import { STELLA_SYSTEM_PROMPT, VFF_PREFIX, buildSystemPrompt } from "../lib/chat/system-prompt.mjs";
import { handleWeather } from "../lib/chat/weather.mjs";
import { runGitHubIntent } from "../lib/chat/github-actions.mjs";
import { prepareSearchContext, searchDriveContext, buildDriveContext, buildDriveReadSummary } from "../lib/chat/context.mjs";
import {
  getMemoryPrompt, needsFullMemory, extractMemoryFromConversation, persistExtractedMemory,
} from "../lib/chat/memory.mjs";
import { callResponses, streamResponses, callOpenAI } from "../lib/chat/openai-client.mjs";
import { callClaude, isClaudeModelName } from "../lib/chat/claude-client.mjs";
import { analyzeAbapInChunks, shouldChunkAbap } from "../lib/chat/abap-analyze.mjs";

// 하위 호환: 다른 라우트(api/cc/*, api/codex/agent.js)와 테스트가 이 경로에서 import 한다.
export { detectDriveIntent, trimHistoryByChars, isTpmError };

// 이미지 base64 합산 상한 — 초과 시 비전 호출 전에 한국어로 안내(본문/비전 토큰 한도 초과 방지).
const MAX_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_HISTORY_CHARS = 24000;

// 응답 지연 없이(setImmediate) 대화에서 메모리를 추출·저장한다.
function scheduleMemoryUpdate({ userId, history, message, answer, isClaudeModel }) {
  setImmediate(async () => {
    try {
      const newItems = await extractMemoryFromConversation({ history, message, answer, isClaudeModel });
      await persistExtractedMemory(userId, newItems);
    } catch (e) { console.warn("[Memory] 업데이트 실패:", e.message); }
  });
}

// Stella GPT(루트 /) 라우팅 경로: web_search + gpt-4o. 429면 mini → mini+히스토리 축소로 자가 치유.
async function callRoutedWithTpmFallback(args, timings) {
  try {
    return await callResponses({ ...args, model: "gpt-4o" });
  } catch (e) {
    if (!isTpmError(e)) throw e;
    timings.tpmFallback = "gpt-4o-mini";
    try {
      return await callResponses({ ...args, model: "gpt-4o-mini" });
    } catch (e2) {
      if (!isTpmError(e2)) throw e2;
      timings.tpmFallback = "gpt-4o-mini+trim";
      return await callResponses({ ...args, model: "gpt-4o-mini", history: args.history.slice(-4) });
    }
  }
}

// SSE 스트리밍 응답(클라가 stream:true로 opt-in 시에만). 실패해도 클라가 비스트리밍으로 폴백한다.
async function respondStreaming(res, args) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // 프록시 버퍼링 방지
  let full = "";
  try {
    full = await streamResponses({
      ...args,
      model: "gpt-4o",
      onDelta: (d) => { try { res.write(`data: ${JSON.stringify({ delta: d })}\n\n`); } catch (e) {} },
    });
    try { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); } catch (e) {}
  } catch (e) {
    const msg = String((e && e.message) || e || "stream error").replace(/sk-[A-Za-z0-9_-]{12,}/g, "***").slice(0, 200);
    try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); } catch (e2) {}
  }
  try { res.end(); } catch (e) {}
  return full;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body || {};
    const message = String(body.message || "");
    // TPM 절약: 히스토리(첨부 텍스트 포함) 문자 총량을 최근 우선으로 제한 —
    // 첨부·Drive 컨텍스트가 겹치면 요청이 40K+ 토큰으로 불어 429가 나던 문제의 1차 가드.
    const history = trimHistoryByChars(Array.isArray(body.history) ? body.history : [], MAX_HISTORY_CHARS);
    const model = body.model || "gpt-4.1-mini";
    const system = body.system || STELLA_SYSTEM_PROMPT;
    const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
    // 인증 토큰이 있으면 메모리 스코프를 토큰 uid 로 강제(타인 메모리 접근 차단). 없으면 기존 값 폴백(비차단).
    const authUser = getAuthUser(req);
    const userId = (authUser && authUser.uid) || String(body.userId || body.user_id || "").trim() || "anonymous";

    // 프론트가 이미 1568px/JPEG로 다운스케일하므로 정상 첨부는 통과.
    const imgBytes = images.reduce((a, u) => a + (typeof u === "string" ? u.length : 0), 0);
    if (imgBytes > MAX_IMAGE_BYTES) {
      return res.status(200).json({ ok: true, provider: "vision-guard",
        text: "첨부 이미지 용량이 너무 큽니다(합산 ~18MB 초과). 캡쳐를 더 작게(텍스트 위주로 잘라서) 다시 올리거나, 이미지를 1~2장으로 줄여 주세요." });
    }

    // ── 구간별 타이밍(병목 특정용). 응답 timings + 서버 로그로 남김 ──
    const t0 = Date.now();
    const timings = {};
    const mark = (k) => { timings[k] = Date.now() - t0; };

    // 메모리 로드를 검색/Drive와 병렬로 선(先)착수 (userId만 의존, 결과는 아래에서 await)
    const memStart = Date.now();
    const memoryPromise = getMemoryPrompt(userId, needsFullMemory(history, message))
      .then((r) => { timings.memoryMs = Date.now() - memStart; timings.memoryCached = r.cached; return r.prompt; })
      .catch(() => { timings.memoryMs = Date.now() - memStart; return ""; });

    // ① 날씨 직접 처리 (모델 호출 없음)
    if (isWeatherQuery(message)) {
      const weatherResult = await handleWeather(message);
      if (weatherResult) return res.status(200).json({ ok: true, text: weatherResult, provider: "weather" });
    }

    // ② GitHub 직접 실행 (실패하면 null → AI 폴백)
    const githubText = await runGitHubIntent(detectGitHubIntent(message));
    if (githubText) return res.status(200).json({ ok: true, text: githubText, provider: "github" });

    // ③ 일반 AI 처리 — 키워드 게이트로 불필요한 외부 호출 제거
    // skipDrive: 클라이언트(gpt.html 분석 플로우 등)가 이미 Drive 내용을 읽어 message에 넣은 경우
    // 서버가 같은 폴더를 중복으로 다시 읽지 않게 하는 opt-in 플래그.
    const needsDrive = body.skipDrive === true ? false : detectDriveIntent(message);

    let searchContext = { used: false };
    if (needsRealtimeSearch(message) || needsWeatherContext(message)) {
      try { searchContext = await prepareSearchContext(message); } catch (e) {}
    }

    let aiMessage = message;
    let driveContext = null;
    let actualDriveContext = null;
    if (needsDrive) {
      ({ aiMessage, driveContext, actualDriveContext } = await buildDriveContext(message));
    } else if (needsSapDriveSearch(message)) {
      driveContext = await searchDriveContext(message);
    }
    mark("contextMs"); // 검색+Drive 구간 종료 시점

    // ④ 메모리 회수 — 위에서 병렬 착수한 promise (추가 대기 최소화)
    const memoryPrompt = await memoryPromise;
    mark("preModelMs");
    // 정적 시스템 프롬프트를 앞에, 자주 바뀌는 메모리를 뒤에 배치 —
    // 프롬프트 프리픽스가 안정되어 제공자측 자동 프롬프트 캐싱에 유리하고, 지시문이 항상 먼저 온다.
    const prompt = buildSystemPrompt(system + (memoryPrompt ? "\n\n" + memoryPrompt : ""), searchContext, driveContext);

    // 모델 기반으로 API 완전 분리 (Claude 선택 시 OpenAI 절대 미호출)
    const isClaudeModel = isClaudeModelName(model);
    const routed = !!body.route && !isClaudeModel; // Stella GPT(루트 /)만 body.route 전송
    let answer;
    let provider;
    let usageInfo = null; // Stella Codex(bare+wantUsage) 전용 — 그 외 호출부는 항상 null
    const modelStart = Date.now();

    if (routed) {
      const wantTable = wantsTable(message);
      // 메모리 노드 + Drive 컨텍스트는 extra 로 합쳐 보존. 표는 온디맨드.
      // 검색 게이트 제거: web_search를 항상 제공해 모델이 필요할 때 검색(맛집·장소·실시간 정확도 ↑, 환각 제거).
      const routeSys = routeSystemPrompt({ table: wantTable, extra: [memoryPrompt, driveContext].filter(Boolean).join("\n\n") });
      // #드라이브 명령은 web_search보다 우선 → 그땐 검색 미제공(Drive 내용으로 답). 그 외엔 항상 web_search.
      const useSearch = !needsDrive;
      const callArgs = { system: routeSys, history, message: aiMessage, images, search: useSearch };
      provider = useSearch ? "openai-search" : "openai";

      if (body.stream === true) {
        const full = await respondStreaming(res, callArgs);
        scheduleMemoryUpdate({ userId, history, message: aiMessage, answer: full, isClaudeModel: false });
        return;
      }
      answer = await callRoutedWithTpmFallback(callArgs, timings);
      timings.routed = true; timings.searchAlways = useSearch; timings.driveFirst = needsDrive; timings.tableUsed = wantTable;
    } else if (isClaudeModel) {
      provider = "claude";
      const finalPrompt = body.vff === true ? VFF_PREFIX + "\n\n" + prompt : prompt;
      answer = await callClaude({ model, system: finalPrompt, history, message: aiMessage, images });
    } else {
      provider = "openai";
      const wantUsage = !!body.bare && !!body.wantUsage; // Stella Codex 비용 표시 전용
      const { use: useChunking } = shouldChunkAbap({ system: prompt, message: aiMessage, history, isDriveQuery: needsDrive });
      if (useChunking) {
        const chunked = await analyzeAbapInChunks({ model, system: prompt, question: message, payload: aiMessage, images });
        answer = chunked.text;
        provider = "openai-chunked";
        timings.abapChunks = chunked.chunks;
        if (wantUsage) usageInfo = { usage: chunked.usage, model: chunked.model || model };
      } else {
        const openaiResult = await callOpenAI({ model, system: prompt, history, message: aiMessage, images, bare: !!body.bare, returnUsage: wantUsage });
        if (wantUsage && openaiResult && typeof openaiResult === "object") {
          answer = openaiResult.text;
          usageInfo = { usage: openaiResult.usage, model: openaiResult.model };
        } else {
          answer = openaiResult;
        }
      }
    }
    timings.modelMs = Date.now() - modelStart;
    timings.totalMs = Date.now() - t0;
    try { console.log("[chat timings]", provider, model, JSON.stringify(timings)); } catch (e) {}

    // ⑤ 메모리 업데이트 (비동기 - 응답 지연 없음)
    scheduleMemoryUpdate({ userId, history, message: aiMessage, answer, isClaudeModel });

    return res.status(200).json({
      ok: true,
      text: answer,
      provider,
      timings,
      searchContext,
      driveRead: buildDriveReadSummary(actualDriveContext),
      ...(usageInfo ? { usage: usageInfo.usage, costUsd: estimateOpenAiCostUsd(usageInfo.model, usageInfo.usage) } : {}),
    });
  } catch (error) {
    // 어떤 예외에서도 JSON 반환(프런트 safeJson 호환). 타임아웃/중단은 504 + 안내, 그 외 500.
    const raw = String((error && error.message) || error || "chat error");
    const isAbort = (error && error.name === "AbortError") || /abort|timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(raw);
    const safe = raw.replace(/sk-[A-Za-z0-9_-]{12,}/g, "***").slice(0, 300); // 혹시 모를 키 마스킹
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(isAbort ? 504 : 500).json({
      ok: false,
      error: isAbort ? "응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요." : safe,
    });
  }
}
