// Stella GPT 답변 마크다운 렌더 — marked + DOMPurify. (**굵게**가 별표로 새던 버그 수정)
// CDN 미로드/실패 시 false 반환 → 호출부가 기존 renderMarkdownLite 폴백을 쓴다.
(function () {
  function render(el, text) {
    var s = String(text == null ? "" : text);
    try {
      if (el && window.marked && window.DOMPurify) {
        var html = window.marked.parse(s, { breaks: true, gfm: true });
        el.innerHTML = window.DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
        return true;
      }
    } catch (e) { /* 폴백으로 위임 */ }
    return false;
  }
  window.stellaRenderMarkdown = render;
})();
