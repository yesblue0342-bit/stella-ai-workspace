// lib/router.mjs (v2)
// Stella GPT 답변 라우팅 — 순수 함수만. 검색은 모델이 결정(web_search 상시 제공), 표는 온디맨드.

export function wantsTable(text = "") {
  const t = String(text).toLowerCase();
  return /표로|표 형태|표형태|테이블|table|비교표|표.*정리|정리.*표|markdown table/.test(t);
}

export function buildSystemPrompt({ table = false, extra = "" } = {}) {
  const lines = [
    "당신은 Stella GPT입니다. 한국어로 자연스럽고 간결하게 답합니다.",
    "확실하지 않거나 최신·지역·실시간 정보(맛집·장소·가격·뉴스·일정·인물 근황 등)가 필요하면 추측하지 말고 web_search로 확인한 뒤 핵심을 요약하고 출처를 표시합니다.",
    "기본 출력은 대화형 산문입니다. 불필요한 표, 머리말, 과한 굵은 글씨를 쓰지 않습니다.",
  ];
  if (table) lines.push("사용자가 표를 요청했으므로 핵심 데이터를 마크다운 표로 정리해 제시합니다.");
  else lines.push("표를 만들지 않습니다. 목록이 꼭 필요할 때만 짧은 불릿을 사용합니다.");
  if (extra && String(extra).trim()) lines.push(String(extra).trim());
  return lines.join("\n");
}

export function extractText(data = {}) {
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  const out = Array.isArray(data.output) ? data.output : [];
  const msg = out.find((o) => o && o.type === "message");
  const content = msg && Array.isArray(msg.content) ? msg.content : [];
  const text = content.filter((c) => c && c.type === "output_text").map((c) => c.text).join("\n");
  return text || "응답을 생성하지 못했습니다.";
}
