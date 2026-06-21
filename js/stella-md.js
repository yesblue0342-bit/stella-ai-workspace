// Stella GPT 답변 마크다운 렌더 — marked + DOMPurify. (**굵게**가 별표로 새던 버그 수정)
// + 회귀 복원: 렌더 후 코드블록/표에 복사 버튼 부착(이전 renderMarkdownLite가 제공하던 기능).
// CDN 미로드/실패 시 false 반환 → 호출부가 기존 renderMarkdownLite 폴백을 쓴다.
(function () {
  function copyText(text, btnEl) {
    // index.html의 stellaCopyText(토스트 포함)가 있으면 사용, 없으면 자체 폴백.
    if (typeof window.stellaCopyText === "function") { window.stellaCopyText(text, btnEl); return; }
    var done = function (ok) {
      if (btnEl) { var o = btnEl.textContent; btnEl.textContent = ok ? "복사됨" : "실패"; setTimeout(function () { btnEl.textContent = o; }, 1200); }
      try { if (window.stellaShowToast) window.stellaShowToast(ok ? "복사됨" : "복사 실패"); } catch (e) {}
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(String(text || "")).then(function () { done(true); }, function () { done(false); }); return; }
    } catch (e) {}
    try { var ta = document.createElement("textarea"); ta.value = String(text || ""); ta.style.position = "fixed"; ta.style.left = "-9999px"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(true); } catch (e) { done(false); }
  }
  function mkBtn(label, onClick) {
    var b = document.createElement("button"); b.type = "button"; b.className = "copy-btn"; b.textContent = label;
    b.onclick = function () { onClick(b); }; return b;
  }
  function tableToTSV(tbl) {
    var rows = [];
    tbl.querySelectorAll("tr").forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll("th,td").forEach(function (c) { cells.push(String(c.innerText || "").replace(/\t/g, " ").replace(/\r?\n/g, " ")); });
      if (cells.length) rows.push(cells.join("\t"));
    });
    return rows.join("\n");
  }
  function addCopyButtons(el) {
    // 코드블록: 우상단 복사 버튼
    el.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".copy-btn")) return;
      var code = pre.querySelector("code") || pre;
      pre.style.position = pre.style.position || "relative";
      var b = mkBtn("복사", function (bt) { copyText(code.innerText, bt); });
      b.style.position = "absolute"; b.style.top = "6px"; b.style.right = "6px";
      pre.appendChild(b);
    });
    // 표: 위쪽 작은 툴바(TSV 복사 = 엑셀 붙여넣기 가능)
    el.querySelectorAll("table").forEach(function (tbl) {
      if (tbl.previousSibling && tbl.previousSibling.classList && tbl.previousSibling.classList.contains("table-copytools")) return;
      var bar = document.createElement("div"); bar.className = "table-copytools"; bar.style.margin = "6px 0 2px";
      bar.appendChild(mkBtn("표 복사", function (bt) { copyText(tableToTSV(tbl), bt); }));
      tbl.parentNode.insertBefore(bar, tbl);
    });
  }
  function render(el, text) {
    var s = String(text == null ? "" : text);
    try {
      if (el && window.marked && window.DOMPurify) {
        var html = window.marked.parse(s, { breaks: true, gfm: true });
        el.innerHTML = window.DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
        try { addCopyButtons(el); } catch (e) {}
        return true;
      }
    } catch (e) { /* 폴백으로 위임 */ }
    return false;
  }
  window.stellaRenderMarkdown = render;
})();
