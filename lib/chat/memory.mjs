// lib/chat/memory.mjs — KH 장기 기억(메모리 노드) 로드·추출·갱신. api/chat.js 분리의 일부.
//
// 저장소: SQL(lib/memory-db.mjs) 우선 → 비어 있으면 Drive(StellaGPT/memory/{userId}_memory.json) 폴백.
// 비용 절감: (1) 워밍 캐시(60s)로 반복 요청의 메모리 fetch 제거, (2) 사소한 발화("고마워", "ok")는
// 추출용 LLM 호출 자체를 건너뛴다.

import { saveJsonToDrive, readJsonFromDrive, listJsonFromDrive } from "../drive-utils.js";
import { buildMemoryContext, saveMemory as saveMemorySql } from "../memory-db.mjs";
import { callClaudeJson } from "./claude-client.mjs";

const MEMORY_FOLDER = ["memory"];
const MAX_MEMORY_ITEMS = 50; // 항목별 최대 개수
const MEM_TTL_MS = 60000;

/** @type {Map<string, {prompt: string, ts: number}>} */
const _memCache = new Map(); // userId -> { prompt, ts }

/** 메모리를 갱신했으면 워밍 캐시를 버려야 다음 요청이 새 내용을 본다. */
export function invalidateMemoryCache(userId) { _memCache.delete(userId); }

/** 전체 메모리 폴더 스캔이 필요한 질의인가(대화 시작 or 명시적 기억 요청). */
export function needsFullMemory(history, message) {
  return (Array.isArray(history) ? history.length : 0) === 0
    || /기억|메모리|이전|내 정보|나에 대해|알고 있|히스토리/.test(String(message || "").toLowerCase());
}

/**
 * 시스템 프롬프트에 붙일 메모리 텍스트를 얻는다(warm 캐시 60초).
 * @returns {Promise<{prompt: string, cached: boolean}>}
 */
export async function getMemoryPrompt(userId, fullScan) {
  const e = _memCache.get(userId);
  if (e && (Date.now() - e.ts) < MEM_TTL_MS) return { prompt: e.prompt, cached: true };
  let memoryPrompt = await buildMemoryContext(userId);        // SQL 우선
  if (!memoryPrompt) {                                        // 빈값이면 Drive 폴백
    memoryPrompt = memoryToPrompt(await loadMemory(userId, fullScan));
  }
  _memCache.set(userId, { prompt: memoryPrompt || "", ts: Date.now() });
  return { prompt: memoryPrompt || "", cached: false };
}

// ───────── Drive 메모리 저장소 ─────────

const emptyMemory = (userId) => ({ userId, facts: [], patterns: [], preferences: [], context: [], updatedAt: null });

// memory/ 폴더의 추가 export 파일(ChatGPT/Claude 등)에서 사실 배열을 뽑아낸다.
function mergeExternalMemoryFile(base, d) {
  if (Array.isArray(d.facts))       base.facts       = [...base.facts,       ...d.facts];
  if (Array.isArray(d.patterns))    base.patterns    = [...base.patterns,    ...d.patterns];
  if (Array.isArray(d.preferences)) base.preferences = [...base.preferences, ...d.preferences];
  if (Array.isArray(d.context))     base.context     = [...base.context,     ...d.context];
  // {memories: [...]} — ChatGPT 메모리 export 형식
  if (Array.isArray(d.memories)) {
    base.facts = [...base.facts, ...d.memories.map((m) => (typeof m === "string" ? m : (m.memory || m.text || JSON.stringify(m))))];
  }
  // {items: [...]} / {entries: [...]} — 기타 형식
  if (Array.isArray(d.items))   base.facts = [...base.facts, ...d.items.map((m) => (typeof m === "string" ? m : JSON.stringify(m)))];
  if (Array.isArray(d.entries)) base.facts = [...base.facts, ...d.entries.map((m) => (typeof m === "string" ? m : JSON.stringify(m)))];
  // 단순 문자열 배열
  if (Array.isArray(d) && d.every((x) => typeof x === "string")) base.facts = [...base.facts, ...d];
}

/**
 * 메모리 로드 (기본 파일 + fullScan 시 폴더 내 추가 파일 병합).
 * @param {string} userId
 * @param {boolean} fullScan 기본 false — {userId}_memory.json 하나만 읽어 속도 최적화
 */
export async function loadMemory(userId, fullScan = false) {
  const base = emptyMemory(userId);

  try {
    const data = await readJsonFromDrive({ folderPath: MEMORY_FOLDER, fileName: `${userId}_memory` });
    if (data) {
      base.facts = Array.isArray(data.facts) ? data.facts : [];
      base.patterns = Array.isArray(data.patterns) ? data.patterns : [];
      base.preferences = Array.isArray(data.preferences) ? data.preferences : [];
      base.context = Array.isArray(data.context) ? data.context : [];
      base.updatedAt = data.updatedAt || null;
    }
  } catch (e) { /* Drive 미설정/권한 — 메모리는 핵심 챗을 막지 않는다 */ }

  if (!fullScan) return base;

  try {
    const files = await listJsonFromDrive({ folderPath: MEMORY_FOLDER, pageSize: 50 });
    for (const f of files) {
      const fname = f.name.replace(/\.json$/i, "");
      if (fname === `${userId}_memory`) continue; // 기본 파일은 이미 읽음
      try {
        const ext = await readJsonFromDrive({ folderPath: MEMORY_FOLDER, fileName: fname });
        if (!ext || !ext.data) continue;
        mergeExternalMemoryFile(base, ext.data);
        console.log(`[Memory] 추가 파일 로드: ${fname}`);
      } catch (e2) { /* 파일 하나가 깨져도 나머지는 병합 */ }
    }
  } catch (e) { /* 폴더 목록 실패 → 기본 파일만 사용 */ }

  const dedup = (arr) => [...new Set(arr.filter(Boolean))].slice(-MAX_MEMORY_ITEMS);
  base.facts = dedup(base.facts);
  base.patterns = dedup(base.patterns);
  base.preferences = dedup(base.preferences);
  base.context = dedup(base.context);
  return base;
}

/** 메모리를 Drive에 저장(실패해도 채팅은 계속). */
export async function saveMemory(userId, memory) {
  try {
    await saveJsonToDrive({
      folderPath: MEMORY_FOLDER,
      fileName: `${userId}_memory`,
      data: { ...memory, updatedAt: new Date().toISOString() },
    });
  } catch (e) { console.warn("[Memory] 저장 실패:", e.message); }
}

/** 중복 없이 뒤에 붙이고 최대 개수를 유지한다. */
export function addUnique(arr, newArr, maxN) {
  if (!Array.isArray(newArr) || !newArr.length) return arr;
  const existing = new Set(arr.map((x) => String(x).toLowerCase().trim()));
  const filtered = newArr.filter((x) => x && !existing.has(String(x).toLowerCase().trim()));
  return [...arr, ...filtered].slice(-maxN);
}

/** 메모리 업데이트 (중복 제거 + 최대 개수 유지). */
export async function updateMemory(userId, newItems) {
  const memory = await loadMemory(userId);
  if (newItems) {
    memory.facts = addUnique(memory.facts, newItems.facts, MAX_MEMORY_ITEMS);
    memory.patterns = addUnique(memory.patterns, newItems.patterns, 30);
    memory.preferences = addUnique(memory.preferences, newItems.preferences, 30);
    memory.context = addUnique(memory.context, newItems.context, 20);
  }
  await saveMemory(userId, memory);
  return memory;
}

/** 메모리를 시스템 프롬프트용 텍스트로 변환. 빈 메모리면 빈 문자열. */
export function memoryToPrompt(memory) {
  if (!memory) return "";
  const parts = [];
  if (memory.facts?.length) parts.push(`[KH 알려진 사실]\n${memory.facts.slice(-15).map((f) => "• " + f).join("\n")}`);
  if (memory.preferences?.length) parts.push(`[KH 선호도]\n${memory.preferences.slice(-10).map((f) => "• " + f).join("\n")}`);
  if (memory.context?.length) parts.push(`[현재 업무 맥락]\n${memory.context.slice(-8).map((f) => "• " + f).join("\n")}`);
  if (memory.patterns?.length) parts.push(`[질문 패턴]\n${memory.patterns.slice(-8).map((f) => "• " + f).join("\n")}`);
  if (!parts.length) return "";
  const updated = memory.updatedAt ? `(${memory.updatedAt.slice(0, 10)} 기준)` : "";
  return `[=== KH 장기 메모리 ${updated} ===]\n${parts.join("\n\n")}\n[=== 메모리 끝 ===]`;
}

// ───────── 추출 (저가 모델 전용 경로) ─────────

// 인사·맞장구·이어쓰기 요청에는 기억할 사실이 없다 → 추출용 LLM 호출을 통째로 건너뛴다(요청당 1콜 절감).
const TRIVIAL_TURN = /^(?:ㅇㅇ|ㅋ+|ㅎ+|응|넵|네|예|어|알겠어|알겠습니다|알았어|고마워|고맙습니다|감사|감사합니다|땡큐|thanks?|thx|ok(?:ay)?|good|nice|계속|더|이어서\s*계속|continue)[.!~?\s]*$/i;

/** 이 발화에 기억할 만한 정보가 있을 수 있는가(있으면 추출 LLM 호출). */
export function shouldExtractMemory(message) {
  const m = String(message || "").trim();
  if (m.length < 4) return false;
  return !TRIVIAL_TURN.test(m);
}

function buildExtractPrompt({ history, message, answer }) {
  const recentConv = [
    ...history.slice(-6).map((m) => `${m.role === "assistant" ? "Stella" : "KH"}: ${String(m.content || "").slice(0, 200)}`),
    `KH: ${String(message || "").slice(0, 300)}`,
    `Stella: ${String(answer || "").slice(0, 300)}`,
  ].join("\n");

  return `다음 대화에서 KH(사용자)에 대해 기억할 가치 있는 정보를 JSON으로 추출하세요.
추출 기준:
- facts: KH의 확실한 사실 (직업, 프로젝트, 위치, 가족 등)
- patterns: 반복되는 질문 패턴이나 업무 방식
- preferences: 선호도 (답변 형식, 관심사, 좋아하는 것)
- context: 현재 진행 중인 업무나 관심사

없으면 빈 배열. 새 정보만 추출 (기존과 중복 제외).
반드시 JSON만 반환:
{"facts":[],"patterns":[],"preferences":[],"context":[]}

대화:
${recentConv}`;
}

async function callOpenAiJson(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 512, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "JSON only." }, { role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "{}";
}

/**
 * 대화에서 기억할 정보를 추출한다. 항상 저가 모델(gpt-4o-mini / claude-haiku)로만 호출한다.
 * @returns {Promise<{facts: string[], patterns: string[], preferences: string[], context: string[]}|null>}
 */
export async function extractMemoryFromConversation({ history, message, answer, isClaudeModel }) {
  if (!shouldExtractMemory(message)) return null;
  try {
    const prompt = buildExtractPrompt({ history: Array.isArray(history) ? history : [], message, answer });
    const json = isClaudeModel ? await callClaudeJson({ prompt }) : await callOpenAiJson(prompt);
    return JSON.parse(json);
  } catch (e) {
    console.warn("[Memory] 추출 실패:", e.message);
    return null;
  }
}

/** 추출 결과에 실제 항목이 하나라도 있는가. */
export function hasMemoryItems(newItems) {
  return !!newItems && Object.values(newItems).some((a) => Array.isArray(a) && a.length > 0);
}

/**
 * 추출된 항목을 Drive(폴백 보존)와 SQL(우선 백엔드) 양쪽에 기록하고 워밍 캐시를 무효화한다.
 * 응답 지연을 만들지 않도록 호출부가 setImmediate 안에서 부른다. 어느 저장소가 실패해도 던지지 않는다.
 */
export async function persistExtractedMemory(userId, newItems) {
  if (!hasMemoryItems(newItems)) return false;
  await updateMemory(userId, newItems);
  invalidateMemoryCache(userId);
  try {
    for (const [category, arr] of Object.entries(newItems)) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const text = typeof item === "string" ? item : (item && (item.text || item.memory_text));
        if (text && String(text).trim()) {
          await saveMemorySql(userId, { memory_text: String(text).trim(), category, source: "ai_inferred" });
        }
      }
    }
  } catch (e) { /* SQL 미설정/일시 오류 — Drive 사본은 이미 저장됨 */ }
  return true;
}
