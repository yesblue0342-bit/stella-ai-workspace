// js/chat-stream.js — Stella GPT 챗 스트리밍(SSE) 클라이언트 + 점진 렌더 버블.
// window.stellaChatStream(url, bodyObj, opts) → Promise<{ text, streamed, data }>
//  - stream:true로 POST. 응답이 text/event-stream이면 델타를 누적해 임시 버블에 점진 렌더 후 반환(streamed:true).
//  - SSE가 아니거나 비어 있으면 throw → 호출부가 비스트리밍으로 폴백(현재 동작 보존).
(function () {
  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d; }

  // 점진 렌더 임시 버블(미저장). render(full) 호출 시 마크다운(가능하면 marked) 갱신, throttle.
  function makeBubble(container) {
    var row = el("div", "row ai");
    var av = el("div", "avatar"); av.textContent = "S"; row.appendChild(av);
    var b = el("div", "bubble"); row.appendChild(b);
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
    var last = 0, pending = null;
    function paint(full) {
      try {
        if (window.stellaRenderMarkdown && window.stellaRenderMarkdown(b, full)) { /* marked 렌더 */ }
        else b.textContent = full;
      } catch (e) { b.textContent = full; }
      container.scrollTop = container.scrollHeight;
    }
    return {
      render: function (full) {
        var now = Date.now();
        if (now - last > 120) { last = now; paint(full); }
        else { clearTimeout(pending); pending = setTimeout(function () { last = Date.now(); paint(full); }, 120); }
      },
      remove: function () { try { clearTimeout(pending); row.remove(); } catch (e) { /* ignore */ } },
    };
  }

  async function stellaChatStream(url, bodyObj, opts) {
    opts = opts || {};
    var container = document.getElementById(opts.messagesId || "messages");
    var body = {}; for (var k in bodyObj) body[k] = bodyObj[k]; body.stream = true;
    // 스트리밍은 최대 ~290초 걸릴 수 있고, POST 재시도는 모델 호출을 이중으로 유발한다
    // → 타임아웃 300초, 재시도 0(비스트리밍 폴백은 호출부가 담당).
    var res = await (window.stellaFetchRetry || fetch)(url, {
      method: "POST", headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body),
    }, { timeoutMs: 300000, retries: 0 });
    var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
    if (!res.ok || ct.indexOf("text/event-stream") < 0 || !res.body || !res.body.getReader) {
      var e = new Error("not-streamable"); e.code = "NO_STREAM"; throw e; // 비스트리밍 폴백 유도
    }
    var bubble = container ? makeBubble(container) : null;
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = "", full = "", errMsg = "";
    try {
      while (true) {
        var rd = await reader.read();
        if (rd.done) break;
        buf += dec.decode(rd.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          var ev = buf.slice(0, idx); buf = buf.slice(idx + 2);
          var dl = ev.split("\n").find(function (l) { return l.indexOf("data:") === 0; });
          if (!dl) continue;
          var js = dl.slice(5).trim(); if (!js) continue;
          var o; try { o = JSON.parse(js); } catch (e2) { continue; }
          if (typeof o.delta === "string") { full += o.delta; if (bubble) bubble.render(full); }
          else if (o.error) { errMsg = o.error; }
          else if (o.done) { /* 종료 */ }
        }
      }
    } finally { if (bubble) bubble.remove(); }
    if (!full) { var e2 = new Error(errMsg || "empty-stream"); e2.code = "NO_STREAM"; throw e2; }
    // 부분 델타가 온 뒤 서버 오류(o.error)로 끊긴 경우: 그동안의 텍스트를 완결된 답변처럼
    // 저장하면 잘린 답을 정상으로 오인한다 → 중단 표시를 붙이고 truncated 플래그로 알린다.
    // (여기서 비스트리밍 재요청은 같은 모델 호출을 한 번 더 유료로 돌리므로 하지 않는다.)
    if (errMsg) {
      return { text: full + "\n\n⚠️ 답변 생성이 중간에 중단되어 내용이 잘렸을 수 있습니다. 다시 시도해 주세요.", streamed: true, truncated: true, data: {} };
    }
    return { text: full, streamed: true, data: {} };
  }

  if (typeof window !== "undefined") window.stellaChatStream = stellaChatStream;
  if (typeof module !== "undefined" && module.exports) module.exports = { stellaChatStream };
})();
