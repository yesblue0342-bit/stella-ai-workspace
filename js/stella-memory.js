/* js/stella-memory.js — Stella 메모리 프론트 모듈 (별도 .js: \n 이스케이프 함정 회피)
   인증: 기존 앱 패턴대로 userId를 요청 바디로 전달(새 JWT 미사용). window.StellaMemory 노출.
   서버측 chat.js가 이미 자동 추출·저장하므로, 이 모듈은 명시적 승인 UX + 관리 패널용(선택). */
(function () {
  let _userId = null;
  function setUser(id) { _userId = id || null; }
  function withUid(body) { return Object.assign({ userId: _userId || "anonymous" }, body || {}); }
  const J = { "Content-Type": "application/json" };

  const TRIGGERS = ["기억해", "앞으로 기억", "저장해줘", "메모리에 저장", "remember this", "note that"];
  function looksLikeMemoryRequest(text) {
    const t = (text || "").toLowerCase();
    return TRIGGERS.some(k => t.includes(k.toLowerCase()));
  }
  async function extractCandidates(text) {
    const r = await fetch("/api/memory/extract", { method: "POST", headers: J, body: JSON.stringify({ text }) });
    const d = await r.json(); return d.ok ? (d.candidates || []) : [];
  }
  async function saveMemory(memory_text, category) {
    const r = await fetch("/api/memory/save", { method: "POST", headers: J, body: JSON.stringify(withUid({ memory_text, category, source: "user", app_scope: "shared" })) });
    return r.json();
  }
  async function listMemories(q) {
    const u = "/api/memory/search?userId=" + encodeURIComponent(_userId || "anonymous") + (q ? "&q=" + encodeURIComponent(q) : "");
    const r = await fetch(u); const d = await r.json(); return d.ok ? d.memories : [];
  }
  async function updateMemory(memory_id, patch) {
    const r = await fetch("/api/memory/update", { method: "POST", headers: J, body: JSON.stringify(withUid(Object.assign({ memory_id }, patch))) });
    return r.json();
  }
  function esc(s) { return (s || "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

  function injectStyle() {
    if (document.getElementById("stella-mem-style")) return;
    const css = ".stella-mem-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:99999}"
      + ".stella-mem-modal{background:#fff;color:#111;max-width:480px;width:92%;border-radius:14px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.3)}"
      + ".stella-mem-modal h3{margin:0 0 12px;font-size:1.05rem}.stella-mem-list{list-style:none;margin:0 0 14px;padding:0;max-height:50vh;overflow:auto}"
      + ".stella-mem-list li{padding:6px 0}.stella-mem-list em{color:#6b7280;font-size:.82rem}"
      + ".stella-mem-actions{display:flex;gap:8px;justify-content:flex-end}.stella-mem-actions button{padding:8px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;font-weight:700;cursor:pointer}"
      + ".stella-mem-actions .stella-mem-save{background:#1a4731;color:#fff;border-color:#1a4731}"
      + "body.dark .stella-mem-modal{background:#1c2128;color:#e6edf3}";
    const st = document.createElement("style"); st.id = "stella-mem-style"; st.textContent = css; document.head.appendChild(st);
  }

  function showApproval(candidates) {
    injectStyle();
    return new Promise(resolve => {
      const ov = document.createElement("div"); ov.className = "stella-mem-overlay";
      ov.innerHTML = '<div class="stella-mem-modal"><h3>이 내용을 기억할까요?</h3><ul class="stella-mem-list">'
        + candidates.map((c, i) => '<li><label><input type="checkbox" data-i="' + i + '" checked> ' + esc(c.memory_text) + ' <em>(' + esc(c.category || "fact") + ')</em></label></li>').join("")
        + '</ul><div class="stella-mem-actions"><button class="stella-mem-cancel">취소</button><button class="stella-mem-save">저장</button></div></div>';
      document.body.appendChild(ov);
      ov.querySelector(".stella-mem-cancel").onclick = () => { ov.remove(); resolve([]); };
      ov.querySelector(".stella-mem-save").onclick = async () => {
        const picked = Array.from(ov.querySelectorAll("input[type=checkbox]:checked")).map(el => candidates[+el.dataset.i]);
        for (const c of picked) await saveMemory(c.memory_text, c.category);
        ov.remove(); resolve(picked);
      };
    });
  }
  async function maybeCaptureMemory(userText) {
    if (!looksLikeMemoryRequest(userText)) return [];
    const cands = await extractCandidates(userText);
    if (!cands.length) return [];
    return showApproval(cands);
  }

  window.StellaMemory = { setUser, looksLikeMemoryRequest, extractCandidates, saveMemory, listMemories, updateMemory, showApproval, maybeCaptureMemory };
})();
