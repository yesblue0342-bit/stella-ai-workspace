// js/fetch-retry.js — Stella GPT 챗 fetch 재시도 래퍼(타임아웃 AbortController + 지수 백오프).
// window.stellaFetchRetry(url, options, cfg?) — 네트워크 오류/타임아웃/5xx만 재시도(최대 2회 기본). 4xx는 즉시 반환.
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function backoff(n) { return Math.min(1000 * Math.pow(2, n - 1), 8000); } // 1s, 2s, 4s, …(상한 8s)

  async function stellaFetchRetry(url, options, cfg) {
    options = options || {}; cfg = cfg || {};
    var retries = (cfg.retries == null ? 2 : cfg.retries);     // 최대 재시도 2회(총 3회 시도)
    var timeoutMs = cfg.timeoutMs || 90000;                    // 90초 AbortController
    var attempt = 0;
    while (true) {
      var ctrl = new AbortController();
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
      try {
        var opt = {}; for (var k in options) opt[k] = options[k]; opt.signal = ctrl.signal;
        var res = await fetch(url, opt);
        clearTimeout(timer);
        // 5xx(504 게이트웨이 타임아웃 포함)는 일시 오류 → 재시도. 그 외(2xx/4xx)는 그대로 반환.
        if (res.status >= 500 && res.status <= 599 && attempt < retries) { attempt++; await sleep(backoff(attempt)); continue; }
        return res;
      } catch (e) {
        clearTimeout(timer);
        // AbortError(타임아웃) / 네트워크("Failed to fetch") → 재시도. 소진 시 throw.
        if (attempt < retries) { attempt++; await sleep(backoff(attempt)); continue; }
        if (timedOut) { var te = new Error("요청 시간이 초과되었습니다(네트워크 또는 서버 지연)."); te.name = "TimeoutError"; throw te; }
        throw e;
      }
    }
  }
  if (typeof window !== "undefined") window.stellaFetchRetry = stellaFetchRetry;
  if (typeof module !== "undefined" && module.exports) module.exports = { stellaFetchRetry, backoff };
})();
