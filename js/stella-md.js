// Stella GPT 답변 마크다운 렌더 — marked + DOMPurify. (**굵게**가 별표로 새던 버그 수정)
// + 회귀 복원: 렌더 후 코드블록/표에 복사 버튼 부착(이전 renderMarkdownLite가 제공하던 기능).
// CDN 미로드/실패 시 false 반환 → 호출부가 기존 renderMarkdownLite 폴백을 쓴다.
(function () {
  function copyText(text, btnEl) {
    // index.html의 stellaCopyText(토스트 포함)가 있으면 사용, 없으면 자체 폴백.
    if (typeof window.stellaCopyText === "function") { window.stellaCopyText(text, btnEl); return; }
    var done = function (ok) {
      if (btnEl) { var o = btnEl.textContent; btnEl.textContent = ok ? "복사됨" : "실패"; setTimeout(function () { btnEl.textContent = o; }, 1200); }
      try { if (window.stellaShowToast) window.stellaShowToast(ok ? "복사됨" : "복사 실패"); } catch (e) { /* ignore */ }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(String(text || "")).then(function () { done(true); }, function () { done(false); }); return; }
    } catch (e) { /* ignore */ }
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
      tr.querySelectorAll("th,td").forEach(function (c) { var v = (c.innerText != null && c.innerText !== "") ? c.innerText : (c.textContent || ""); cells.push(String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim()); });
      if (cells.length) rows.push(cells.join("\t"));
    });
    return rows.join("\n");
  }
  // 코너 아이콘 버튼(📋/📥)
  function mkIcon(glyph, title, onClick) {
    var b = document.createElement("button"); b.type = "button"; b.className = "stella-tbtn"; b.textContent = glyph; b.title = title;
    b.onclick = function (ev) { try { ev.preventDefault(); ev.stopPropagation(); } catch (e) { /* ignore */ } onClick(b); }; return b;
  }
  function downloadBlob(name, blob) {
    try { var url = URL.createObjectURL(blob); var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { try { a.remove(); URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 1500); } catch (e) { /* ignore */ }
  }
  function tsvToCsv(tsv) { return "﻿" + tsv.split("\n").map(function (r) { return r.split("\t").map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n"); }
  // 표 DOM → 진짜 .xlsx(SheetJS 있으면) 또는 CSV 폴백 다운로드
  function downloadTableXlsx(tbl, btnEl) {
    var stamp;
    try { stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); } catch (e) { stamp = "table"; }
    var okMark = function () { if (btnEl) { var o = btnEl.textContent; btnEl.textContent = "✓"; setTimeout(function () { btnEl.textContent = o; }, 1200); } try { if (window.stellaShowToast) window.stellaShowToast("Excel 다운로드"); } catch (e) { /* ignore */ } };
    try {
      if (window.XLSX && window.XLSX.utils && window.XLSX.utils.table_to_sheet) {
        var ws = window.XLSX.utils.table_to_sheet(tbl);
        var wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, "Stella");
        var arr = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
        downloadBlob("stella-table-" + stamp + ".xlsx", new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        return okMark();
      }
    } catch (e) { /* CSV 폴백 */ }
    try { downloadBlob("stella-table-" + stamp + ".csv", new Blob([tsvToCsv(tableToTSV(tbl))], { type: "text/csv;charset=utf-8" })); okMark(); } catch (e2) { /* ignore */ }
  }
  function ensureTableStyle() {
    if (typeof document === "undefined" || document.getElementById("stella-table-style")) return;
    var st = document.createElement("style"); st.id = "stella-table-style";
    st.textContent =
      ".stella-table-wrap{position:relative;overflow-x:auto;margin:10px 0}" +
      ".stella-table-tools{position:absolute;top:4px;right:6px;display:flex;gap:5px;z-index:3}" +
      ".stella-tbtn{border:1px solid var(--line,#d1d5db);background:var(--card,#fff);color:var(--ink,#111827);border-radius:8px;padding:2px 8px;font-size:14px;line-height:1.3;cursor:pointer;opacity:.5;transition:opacity .15s;box-shadow:0 1px 4px rgba(15,23,42,.12)}" +
      ".stella-tbtn:hover{opacity:1}.stella-table-wrap:hover .stella-tbtn{opacity:.95}" +
      "body.dark .stella-tbtn{background:#161b22;border-color:#30363d;color:#e6edf3}";
    (document.head || document.documentElement).appendChild(st);
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
    // 표: 우측 상단 코너에 복사(📋)·Excel 다운로드(📥) 아이콘 (ChatGPT 식, 한 번에 복사/다운로드)
    ensureTableStyle();
    el.querySelectorAll("table").forEach(function (tbl) {
      var parent = tbl.parentNode;
      if (!parent) return;
      if (parent.classList && parent.classList.contains("stella-table-wrap")) return; // 이미 처리됨
      var wrap = document.createElement("div"); wrap.className = "stella-table-wrap";
      parent.insertBefore(wrap, tbl); wrap.appendChild(tbl);
      var tools = document.createElement("div"); tools.className = "stella-table-tools";
      tools.appendChild(mkIcon("📋", "표 복사 (엑셀 붙여넣기)", function (bt) { copyText(tableToTSV(tbl), bt); }));
      tools.appendChild(mkIcon("📥", "Excel 다운로드", function (bt) { downloadTableXlsx(tbl, bt); }));
      wrap.appendChild(tools);
    });
  }
  // ── 표 정상화 ──────────────────────────────────────────────
  // 모델이 표를 ```코드블록으로 감싸거나 구분선(|---|) 없이 내보내면 표가 '깨진' 파이프
  // 텍스트로 보인다(간헐적 — 프롬프트로 줄여도 0이 안 됨). 렌더 전에 결정적으로 고친다:
  //  ① 코드펜스 내용이 사실상 마크다운 표면 펜스를 벗겨 진짜 표로 렌더.
  //  ② 파이프 행 묶음에 구분선이 없으면 헤더 다음에 |---| 를 만들어 GFM 표로 인식되게.
  //  ③ 진짜 코드(쉘 파이프 등)가 든 펜스는 절대 건드리지 않는다.
  function isPipeRow(l) { var t = String(l || "").trim(); return t.length > 1 && t.charAt(0) === "|" && t.indexOf("|", 1) > 0; }
  function isSepRow(l) { var t = String(l || "").trim(); return t.indexOf("-") >= 0 && /^\|?[\s:\-|]+\|?$/.test(t); }
  function looksLikeTable(body) {
    var lines = String(body || "").split("\n").filter(function (l) { return l.trim() !== ""; });
    if (lines.length < 2) return false;
    var pipe = lines.filter(isPipeRow).length;
    return pipe >= 2 && pipe / lines.length >= 0.8; // 대부분이 |행|이면 표로 판단
  }
  function unwrapTableFences(text) {
    return String(text == null ? "" : text).replace(/```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)```/g, function (m, lang, body) {
      return looksLikeTable(body) ? "\n" + body.replace(/^\n+|\n+$/g, "") + "\n" : m;
    });
  }
  function ensureSeparators(seg) {
    var lines = String(seg == null ? "" : seg).split("\n"), out = [], i = 0;
    while (i < lines.length) {
      if (!isPipeRow(lines[i])) { out.push(lines[i]); i++; continue; }
      var start = i; while (i < lines.length && isPipeRow(lines[i])) i++;
      var run = lines.slice(start, i);
      out.push(run[0]);
      if (run.length >= 2 && !run.some(isSepRow)) {
        var inner = run[0].trim().replace(/^\|/, "").replace(/\|$/, "");
        var n = Math.max(1, inner.split("|").length);
        out.push("|" + new Array(n + 1).join("---|"));
      }
      for (var k = 1; k < run.length; k++) out.push(run[k]);
    }
    return out.join("\n");
  }
  function normalizeMdTables(text) {
    var s = unwrapTableFences(text);
    // 남은(진짜 코드) 펜스 내부는 보호 — 바깥 텍스트만 구분선 보정
    var parts = s.split(/(```[\s\S]*?```)/);
    for (var i = 0; i < parts.length; i++) { if (parts[i].indexOf("```") !== 0) parts[i] = ensureSeparators(parts[i]); }
    return parts.join("");
  }

  function render(el, text) {
    var s = String(text == null ? "" : text);
    try { s = normalizeMdTables(s); } catch (e) { /* 정상화 실패 시 원문 렌더 */ }
    try {
      if (el && window.marked && window.DOMPurify) {
        var html = window.marked.parse(s, { breaks: true, gfm: true });
        el.innerHTML = window.DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
        try { addCopyButtons(el); } catch (e) { /* ignore */ }
        return true;
      }
    } catch (e) { /* 폴백으로 위임 */ }
    return false;
  }
  window.stellaNormalizeMdTables = normalizeMdTables; // 폴백 렌더러(renderMarkdownLite)도 공용
  window.stellaRenderMarkdown = render;
})();
