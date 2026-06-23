// js/source-guard.js — 0Program 저장 가드(공유). 거부/비소스 응답은 절대 커밋 금지.
// window.shouldSaveSource(answer) → boolean. (codex/cc/abap 공용)
(function () {
  // 거부/오류 패턴: 하나라도 매치되면 저장 금지.
  var REFUSE = /죄송하지만|직접 확인할 수 없|첨부.*확인할 수 없|cannot (see|view|access)|I (can.?t|cannot)|응답 없음|API 연결 오류/i;
  function shouldSaveSource(answer) {
    var t = String(answer == null ? "" : answer).trim();
    if (!t) return false;
    if (t.indexOf("```") < 0) return false; // 코드펜스(```) 1개 이상 필수
    if (REFUSE.test(t)) return false;        // 거부/오류 응답 차단
    return true;
  }
  if (typeof window !== "undefined") window.shouldSaveSource = shouldSaveSource;
  if (typeof module !== "undefined" && module.exports) module.exports = { shouldSaveSource };
})();
