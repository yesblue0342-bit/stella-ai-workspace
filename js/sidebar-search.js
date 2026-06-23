// js/sidebar-search.js — Stella GPT 사이드바 검색 견고화(이벤트 위임). 재렌더에도 유실 안 됨.
// 3경로 보장: 🔍 버튼 클릭 / 입력창 Enter / 실시간 input. 핸들러는 window.doSideSearch·doSideSearchLive 호출.
(function () {
  function liveSearch(v) {
    if (typeof window.doSideSearchLive === "function") return window.doSideSearchLive(v);
    console.warn("[sidebar-search] doSideSearchLive 미정의");
  }
  function runSearch() {
    if (typeof window.doSideSearch === "function") return window.doSideSearch();
    console.warn("[sidebar-search] doSideSearch 미정의");
  }

  // document 레벨 이벤트 위임 → 사이드바가 다시 그려져도 동작 유지.
  function bind() {
    // 🔍 버튼 클릭
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("#sideSearchBtn") : null;
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      runSearch();
    }, true);

    // 입력창: 실시간 input + Enter
    document.addEventListener("input", function (e) {
      if (!e.target || e.target.id !== "sideSearch") return;
      liveSearch(e.target.value);
    });
    document.addEventListener("keydown", function (e) {
      if (!e.target || e.target.id !== "sideSearch") return;
      if (e.key === "Enter") { e.preventDefault(); runSearch(); }
    });

    // 가시성 가드: 요소가 실제로 존재하는지 1회 점검(향후 회귀 가시화).
    if (!document.getElementById("sideSearch")) console.warn("[sidebar-search] #sideSearch 미발견");
    if (!document.getElementById("sideSearchBtn")) console.warn("[sidebar-search] #sideSearchBtn 미발견");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
