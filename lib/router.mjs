// lib/router.mjs
// Stella GPT 답변 라우팅 로직 — 순수 함수만 (네트워크 X, 테스트 가능)

export function needsWebSearch(text = "") {
  const t = String(text).toLowerCase();
  const patterns = [
    /오늘|현재|지금|최신|실시간|today|now|latest|current/,
    /\d{4}\s*년|\d{1,2}\s*월|\d{1,2}\s*일/,
    /환율|주가|시세|날씨|뉴스|순위|스코어|승패|결과|일정|랭킹/,
    /price|stock|weather|news|score|standings|schedule|ranking/,
    /월드컵|올림픽|선거|발매|출시|버전|업데이트|release|version/,
  ];
  return patterns.some((re) => re.test(t));
}

export function wantsTable(text = "") {
  const t = String(text).toLowerCase();
  return /표로|표 형태|표형태|테이블|table|비교표|표.*정리|정리.*표|markdown table/.test(t);
}

export function buildSystemPrompt({ table = false, extra = "" } = {}) {
  const lines = [
    "당신은 Stella GPT입니다. 한국어로 자연스럽고 간결하게 답합니다.",
    "기본 출력은 대화형 산문입니다. 불필요한 표, 머리말, 과한 굵은 글씨를 쓰지 않습니다.",
  ];
  if (table) {
    lines.push("사용자가 표를 요청했으므로 핵심 데이터를 마크다운 표로 정리해 제시합니다.");
  } else {
    lines.push("표를 만들지 않습니다. 목록이 꼭 필요할 때만 짧은 불릿을 사용합니다.");
  }
  lines.push("웹 검색 결과를 쓸 때는 핵심 사실을 자신의 말로 요약하고 출처를 함께 표시합니다.");
  // 기존 메모리 노드(kh_memory.json) 등 추가 컨텍스트는 extra 로 합친다.
  if (extra && String(extra).trim()) lines.push(String(extra).trim());
  return lines.join("\n");
}

export function pickModel({ search = false } = {}) {
  return search ? "gpt-4o" : "gpt-4o-mini";
}

export function extractText(data = {}) {
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  const out = Array.isArray(data.output) ? data.output : [];
  const msg = out.find((o) => o && o.type === "message");
  const content = msg && Array.isArray(msg.content) ? msg.content : [];
  const text = content
    .filter((c) => c && c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
  return text || "응답을 생성하지 못했습니다.";
}
