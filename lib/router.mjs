// lib/router.mjs (v2)
// Stella GPT 답변 라우팅 — 순수 함수만. 검색은 모델이 결정(web_search 상시 제공), 표는 온디맨드.

export function wantsTable(text = "") {
  const t = String(text).toLowerCase();
  // 표 요청 + '파일/엑셀/다운로드/스펙' 류(구조화 출력이 유용)도 표로 처리.
  // → 엑셀 다운로드 요청 시 표가 만들어져 앱이 Excel/복사 버튼을 붙인다.
  return /표로|표 형태|표형태|테이블|table|비교표|표.*정리|정리.*표|markdown table|엑셀|excel|xlsx|csv|스프레드시트|다운로드|다운받|내려받|워드|docx|파워포인트|powerpoint|스펙|사양|명세|파라미터/.test(t);
}

export function buildSystemPrompt({ table = false, extra = "" } = {}) {
  const lines = [
    "당신은 Stella GPT입니다. 한국어로 자연스럽고 간결하게 답합니다.",
    "확실하지 않거나 최신·지역·실시간 정보(맛집·장소·가격·뉴스·일정·인물 근황 등)가 필요하면 추측하지 말고 web_search로 확인한 뒤 핵심을 요약하고 출처를 표시합니다.",
    // ★ 다운로드/복사 능력 고지 — 모델이 '기능 없음'이라며 거절하지 않게.
    "이 앱은 당신의 답변에 자동으로 Excel·Word·PPT·TXT·Markdown 다운로드 버튼과 표·URL 복사 버튼을 붙여줍니다. 따라서 '다운로드/엑셀 기능이 없다·제공할 수 없다'거나 '직접 복사해서 붙여넣으라'고 말하지 마세요. 사용자가 파일(엑셀·워드·PPT 등)이나 다운로드를 요청하면, 필요한 내용을 깔끔한 마크다운 표로 정리해 제시하면 됩니다(그러면 사용자가 버튼으로 바로 내려받거나 복사합니다).",
    "기본 출력은 대화형 산문입니다. 불필요한 표, 머리말, 과한 굵은 글씨를 쓰지 않습니다.",
  ];
  if (table) lines.push("이번 요청은 표·파일·다운로드 성격이므로 핵심 데이터를 마크다운 표로 정리해 제시합니다(첫 행을 헤더로). 표로 주면 사용자가 Excel로 즉시 내려받고 복사할 수 있습니다.");
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
