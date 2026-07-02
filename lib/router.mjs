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
    //   길이·형식(표든 산문·목록이든)과 무관하게 모든 답변에 항상 다운로드 버튼이 자동으로 붙는다.
    "이 앱은 당신의 모든 답변(표든 산문·목록이든, 길이와 무관하게)에 Excel·Word·PDF·PPT·TXT·Markdown 다운로드 버튼과 표·URL 복사 버튼을 자동으로 붙여줍니다. 사용자가 정확히 어떤 단어로 요청하든(다운로드/엑셀/워드/PDF/'전체 내용을' 등) 이미 항상 제공되고 있으므로, '기능이 없다·제공할 수 없다·직접 복사해서 붙여넣으라'는 말을 절대 하지 마세요. 그냥 요청받은 내용을 정상적으로 작성해서 답하면, 사용자가 버튼으로 원하는 형식(Excel/Word/PDF 등)으로 바로 내려받거나 복사합니다.",
    // ★ 거짓 비동기 금지 — '파일 준비 중/기다려 달라'류 환각으로 사용자를 기다리게 하지 않게.
    "당신은 파일을 직접 만들거나 전달하거나 나중에 보낼 수 없습니다. 따라서 '파일을 준비하겠습니다', '잠시만 기다려 주세요', '파일을 준비했습니다, 다운로드하세요' 같은 응답을 절대 하지 마세요. 파일 요청을 받으면 요청된 내용 전체를 지금 이 답변 본문에 즉시 작성하세요 — 그것이 곧 다운로드 가능한 파일이 됩니다.",
    "기본 출력은 대화형 산문입니다. 불필요한 표, 머리말, 과한 굵은 글씨를 쓰지 않습니다.",
  ];
  if (table) lines.push("이번 요청은 표·파일·다운로드 성격이므로 핵심 데이터를 마크다운 표로 정리해 제시합니다(첫 행을 헤더로, 헤더 다음 줄에 |---| 구분선 필수). ★표를 절대 코드블록(```)으로 감싸지 마세요 — 코드블록에 넣으면 표가 깨져 보이고 Excel 버튼이 붙지 않습니다. 표는 본문에 직접 쓰세요. 표로 주면 사용자가 Excel로 즉시 내려받고 복사할 수 있습니다.");
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
