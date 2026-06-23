// js/attach-encode.js — 이미지 첨부 base64 인코딩 레이스 방지(공유). Stella Codex / Agent Code 전용.
// 증상: 첨부 뱃지는 떠도 readAsDataURL onload(비동기) 완료 전에 전송되면 base64 누락 → 모델이 텍스트만 수신.
// 해결: 인코딩을 Promise로, 진행 카운트 추적 + whenReady()로 전송 전 대기.
(function () {
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      try {
        var r = new FileReader();
        r.onload = function () { resolve(String(r.result || "")); };
        r.onerror = function () { reject(r.error || new Error("file read error")); };
        r.readAsDataURL(file);
      } catch (e) { reject(e); }
    });
  }
  // onChange(pending): 진행 중 인코딩 수가 바뀔 때 호출(전송버튼 비활성/상태표시용).
  function makeAttachEncoder(onChange) {
    var pending = 0, waiters = [];
    function changed() { if (typeof onChange === "function") { try { onChange(pending); } catch (e) {} } }
    function settle() { if (pending === 0) { var w = waiters; waiters = []; w.forEach(function (fn) { try { fn(); } catch (e) {} }); } }
    return {
      pendingCount: function () { return pending; },
      // file → Promise<dataUrl>. 성공/실패 모두 진행 카운트 감소.
      encode: function (file) {
        pending++; changed();
        return readFileAsDataURL(file).then(
          function (s) { pending--; changed(); settle(); return s; },
          function (e) { pending--; changed(); settle(); throw e; }
        );
      },
      // 진행 중 인코딩이 모두 끝날 때까지 대기(전송 직전 호출).
      whenReady: function () { return new Promise(function (res) { if (pending === 0) return res(); waiters.push(res); }); },
    };
  }
  if (typeof window !== "undefined") { window.readFileAsDataURL = readFileAsDataURL; window.makeAttachEncoder = makeAttachEncoder; }
  if (typeof module !== "undefined" && module.exports) module.exports = { readFileAsDataURL, makeAttachEncoder };
})();
