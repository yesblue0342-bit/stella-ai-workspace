// js/code-copy.js — 코드블록/프로그램에 "복사" 단추 부착(드래그 복사 휴먼에러 방지). Codex/Agent Code 공용.
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function copyText(text, btn) {
    var label = btn && (btn.getAttribute("data-label") || "복사");
    var done = function (ok) { if (btn) { btn.textContent = ok ? "복사됨 ✓" : "실패"; setTimeout(function () { btn.textContent = label || "복사"; }, 1200); } };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(text || "")).then(function () { done(true); }, function () { done(fallback(text)); });
        return;
      }
    } catch (e) { /* ignore */ }
    done(fallback(text));
  }
  function fallback(text) {
    try { var ta = document.createElement("textarea"); ta.value = String(text || ""); ta.style.position = "fixed"; ta.style.left = "-9999px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); return ok; } catch (e) { return false; }
  }

  function ensureStyle() {
    if (typeof document === "undefined" || document.getElementById("code-copy-style")) return;
    var st = document.createElement("style"); st.id = "code-copy-style";
    // 테마 토큰(var) 사용 → 다크/라이트 자동. 평소 흐릿, hover 시 또렷(주변과 블렌드).
    st.textContent =
      ".cc-pre{position:relative}" +
      ".code-copy-btn{position:absolute;top:6px;right:6px;font-size:11px;line-height:1.2;padding:3px 9px;border-radius:8px;" +
      "border:1px solid var(--line,#30363d);background:var(--card,#161b22);color:var(--ink,#e6edf3);cursor:pointer;" +
      "opacity:.5;transition:opacity .15s;z-index:2;font-weight:700}" +
      ".code-copy-btn:hover{opacity:1}pre:hover .code-copy-btn{opacity:1}";
    (document.head || document.documentElement).appendChild(st);
  }

  // container 안의 모든 <pre>에 "복사" 단추 부착(중복 방지).
  function attachCodeCopy(container) {
    if (!container || !container.querySelectorAll) return;
    ensureStyle();
    var pres = container.querySelectorAll("pre");
    for (var i = 0; i < pres.length; i++) {
      (function (pre) {
        if (pre.getAttribute("data-copy-attached")) return;
        pre.setAttribute("data-copy-attached", "1");
        if (pre.className.indexOf("cc-pre") < 0) pre.className += (pre.className ? " " : "") + "cc-pre";
        var code = pre.querySelector("code") || pre;
        var btn = document.createElement("button");
        btn.type = "button"; btn.className = "code-copy-btn"; btn.textContent = "복사"; btn.setAttribute("data-label", "복사");
        btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); copyText(code.innerText || code.textContent || "", btn); });
        pre.appendChild(btn);
      })(pres[i]);
    }
  }

  // text → HTML 문자열(코드펜스는 <pre><code>, 일반은 pre-wrap div). 순수 함수(테스트 가능).
  function toCodeHtml(text) {
    var parts = String(text == null ? "" : text).split("```");
    var html = "";
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var c = parts[i]; var nl = c.indexOf("\n"); if (nl >= 0) c = c.slice(nl + 1); // 언어 토큰 줄 제거
        html += '<pre class="cc-pre"><code>' + esc(c.replace(/\n$/, "")) + "</code></pre>";
      } else if (parts[i]) {
        html += '<div style="white-space:pre-wrap">' + esc(parts[i]) + "</div>";
      }
    }
    return html;
  }

  // text를 코드펜스(```)는 <pre><code>로, 일반은 pre-wrap으로 렌더 + 복사단추 부착.
  function renderCodeWithCopy(container, text) {
    if (!container) return;
    container.innerHTML = toCodeHtml(text);
    attachCodeCopy(container);
    return container;
  }

  if (typeof window !== "undefined") { window.attachCodeCopy = attachCodeCopy; window.renderCodeWithCopy = renderCodeWithCopy; window.ccCopyText = copyText; window.toCodeHtml = toCodeHtml; window.ccEsc = esc; }
  if (typeof module !== "undefined" && module.exports) module.exports = { attachCodeCopy, renderCodeWithCopy, copyText, esc, toCodeHtml };
})();
