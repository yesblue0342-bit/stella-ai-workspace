// lib/abap-chunk.mjs — 대용량 ABAP 소스를 구조 경계로 분할하고 청크별 분석 결과를 종합한다 (순수·무의존).
//
// 목표(수용 기준): 30,000 토큰을 넘는 ABAP 소스도 누락 없이(전체 라인 커버리지) 분석하고,
// 청크 경계에 걸친 이슈/중복 이슈를 종합 시 정리한다.
// 분할은 FORM/METHOD/CLASS/FUNCTION/MODULE/INCLUDE/REPORT 등 ABAP 구조 경계를 우선하되,
// 경계가 없어도 hardMax 로 강제 분할해 단일 초대형 청크가 생기지 않게 한다(줄 단위라 라인 중간 절단 없음).

// 새 유닛의 "시작" 경계로 삼는 키워드(줄 앞부분에서 매칭).
const START_BOUNDARY = /^\s*(FORM|METHOD|CLASS|FUNCTION|MODULE|INCLUDE|REPORT|PROGRAM|START-OF-SELECTION|END-OF-SELECTION|INITIALIZATION|LOAD-OF-PROGRAM|AT\s+SELECTION-SCREEN|TOP-OF-PAGE|INTERFACE|TYPE-POOLS)\b/i;

// 소스를 청크 배열로 분할. 각 청크: { index, total, startLine, endLine, text }
// 라인 커버리지 보장: chunks.map(c=>c.text).join("\n") === 원본.
export function chunkAbapSource(source, opts = {}) {
  const src = String(source == null ? "" : source);
  if (!src) return [];
  const maxChars = Math.max(1000, opts.maxChars || 12000);
  const hardMaxChars = Math.max(maxChars, opts.hardMaxChars || Math.round(maxChars * 1.6));

  const lines = src.split("\n");
  const chunks = [];
  let buf = [];
  let bufLen = 0;
  let startLine = 1;

  const flush = (endLine) => {
    if (!buf.length) return;
    chunks.push({ startLine, endLine, text: buf.join("\n") });
    buf = [];
    bufLen = 0;
    startLine = endLine + 1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const isBoundary = START_BOUNDARY.test(line);
    // 이 줄을 넣기 전에 flush 할지 판단:
    //  - 새 유닛 시작 줄이고 현재 버퍼가 목표 크기 이상 → 구조 경계에서 자름(가독/정합성 유지)
    //  - 또는 경계가 없어도 hardMax 초과 → 강제 자름(초대형 단일 유닛 방지)
    if (buf.length && ((isBoundary && bufLen >= maxChars) || bufLen >= hardMaxChars)) {
      flush(lineNo - 1);
    }
    buf.push(line);
    bufLen += line.length + 1; // +1: 줄바꿈
  }
  flush(lines.length);

  const total = chunks.length;
  return chunks.map((c, i) => ({ index: i, total, startLine: c.startLine, endLine: c.endLine, text: c.text }));
}

// ───────── ABAP 소스 판별 (청킹 게이트) ─────────
// 일반 문서 Q&A(대용량 Drive 내용 등)를 청킹하면 답변이 조각나 회귀가 된다 →
// "구조 키워드가 여러 종류 등장하는 코드성 텍스트"일 때만 ABAP 청킹 경로로 보낸다.
const ABAP_SIGNALS = [
  /^\s*FORM\b/im, /^\s*ENDFORM\b/im, /^\s*METHOD\b/im, /^\s*ENDMETHOD\b/im,
  /\bPERFORM\b/i, /\bCALL\s+FUNCTION\b/i, /^\s*DATA:/im, /^\s*REPORT\b/im,
  /\bSELECT\b[\s\S]{0,80}\bFROM\b/i, /\bLOOP\s+AT\b/i, /\bENDLOOP\b/i,
  /^\s*CLASS\b/im, /^\s*ENDCLASS\b/im, /\bTYPES:/i, /\bWRITE:?\s*\//i,
];
export function looksLikeAbap(text) {
  const s = String(text || "");
  if (s.length < 200) return false;
  let hits = 0;
  for (const re of ABAP_SIGNALS) if (re.test(s)) hits++;
  return hits >= 3; // 서로 다른 ABAP 시그널 3종 이상 → 코드로 간주
}

// ───────── 이슈 라인 추출/정규화/중복 제거 ─────────
// 청크 분석 텍스트에서 "이슈처럼 보이는" 줄(불릿/번호 + 오류/경고/문제 키워드)을 뽑는다.
const ISSUE_KW = /(오류|에러|경고|문제|버그|취약|위험|deprecat|error|warning|bug|issue|dump|short\s*dump|런타임|성능|비효율|select\s*\*|무한|누락|potential)/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)]|\[[^\]]*\])\s+/;

export function extractIssueLines(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (BULLET.test(line) && ISSUE_KW.test(line)) out.push(line.trim());
  }
  return out;
}

// 정규화 키(중복 판정용): 불릿/번호 제거 + 공백 축약 + 소문자.
function normKey(s) {
  return String(s || "")
    .replace(BULLET, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// 발견 항목 문자열 리스트를 순서 보존하며 중복 제거.
export function dedupeFindings(list) {
  const seen = new Set();
  const out = [];
  for (const item of (Array.isArray(list) ? list : [])) {
    const k = normKey(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(item).trim());
  }
  return out;
}

// ───────── 청크별 분석 결과 종합 ─────────
// results: [{ index, total, startLine, endLine, text }]  (text = 모델의 청크 분석 결과)
// 반환: 종합 마크다운 문자열(중복 제거된 종합 이슈 목록 + 청크별 상세).
export function mergeAbapAnalyses(results, opts = {}) {
  const list = (Array.isArray(results) ? results : []).filter((r) => r && String(r.text || "").trim());
  if (!list.length) return "";
  if (list.length === 1) return String(list[0].text || "").trim();

  const sorted = list.slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  const total = sorted[0].total || sorted.length;

  // 1) 전 청크의 이슈 라인 취합 → 중복 제거(청크 경계에 걸쳐 중복 보고된 이슈 정리).
  const allIssues = [];
  for (const r of sorted) allIssues.push(...extractIssueLines(r.text));
  const merged = dedupeFindings(allIssues);

  const parts = [];
  parts.push(`대용량 ABAP 소스를 ${total}개 청크로 나누어 전체 라인을 빠짐없이 분석했습니다.`);
  if (merged.length) {
    parts.push("\n## 종합 이슈 (중복 제거)");
    parts.push(merged.map((m) => (BULLET.test(m) ? m : `- ${m}`)).join("\n"));
  }
  if (opts.includeDetail !== false) {
    parts.push("\n## 청크별 상세");
    for (const r of sorted) {
      parts.push(`\n### 청크 ${(r.index || 0) + 1}/${total} (라인 ${r.startLine}–${r.endLine})`);
      parts.push(String(r.text || "").trim());
    }
  }
  return parts.join("\n");
}

export default { chunkAbapSource, looksLikeAbap, extractIssueLines, dedupeFindings, mergeAbapAnalyses };
