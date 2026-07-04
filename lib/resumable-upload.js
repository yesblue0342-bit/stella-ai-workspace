/*
 * lib/resumable-upload.js — Google Drive resumable 업로드를 청크 단위로 안정화 (TODO#2).
 * 브라우저(globalThis.StellaResumable) + Node(module.exports) 공용. 외부 의존 없음 → node --test 가능.
 *
 * 개선점:
 *  · 청크 단위 PUT(Content-Range) — 단발 PUT 대비 대용량/불안정망에서 회복력 ↑.
 *  · 청크별 지수 백오프 재시도(기본 3회: 1s→2s→4s).
 *  · 실패 후 재개: 서버에 'bytes * /total' 질의(308+Range)로 이미 받은 바이트를 파악해
 *    **빠진 부분만** 재전송(중복 전송 회피 = 무결성/대역 절약).
 *  · 무결성 확인: 최종 응답의 fileId 존재 + (size 응답 시) 바이트 수 일치 검사.
 *  · onProgress(sent,total) 콜백으로 진행률/중단지점 기록 가능.
 *
 * Google 사양: 마지막이 아닌 청크는 256KB 배수여야 함. 마지막 청크만 임의 크기 허용.
 */
(function (global) {
  "use strict";

  var MIN_GRANULARITY = 256 * 1024;              // 256KB
  var DEFAULT_CHUNK = 8 * 1024 * 1024;           // 8MB (256KB 배수)
  var DEFAULT_MAX_RETRIES = 3;
  var DEFAULT_BASE_DELAY = 1000;                 // 1s → 2s → 4s

  // ── 순수 헬퍼 (단위 테스트 대상) ───────────────────────────────
  // 청크 크기를 256KB 배수로 내림 정렬(최소 256KB). 마지막 청크 정렬엔 쓰지 않음.
  function alignChunkSize(size) {
    var n = Math.floor(Number(size) || 0);
    if (n < MIN_GRANULARITY) return MIN_GRANULARITY;
    return n - (n % MIN_GRANULARITY);
  }

  // "bytes=0-262143" 또는 "0-262143" → 마지막 확정 바이트 인덱스(262143). 없으면 -1.
  function parseRangeEnd(rangeHeader) {
    if (!rangeHeader) return -1;
    var m = String(rangeHeader).match(/(\d+)\s*-\s*(\d+)\s*$/);
    if (!m) return -1;
    return Number(m[2]);
  }

  // 서버가 확정한 다음 전송 오프셋(= 확정 끝+1). Range 없으면 0(처음부터).
  function nextOffsetFromRange(rangeHeader) {
    var end = parseRangeEnd(rangeHeader);
    return end < 0 ? 0 : end + 1;
  }

  // 지수 백오프 지연(ms): base * 2^(attempt-1). attempt 는 1부터.
  function backoffDelay(attempt, base) {
    var b = Number(base) || DEFAULT_BASE_DELAY;
    return b * Math.pow(2, Math.max(0, (Number(attempt) || 1) - 1));
  }

  // Content-Range 헤더값: bytes {offset}-{end-1}/{total}
  function contentRange(offset, end, total) {
    return "bytes " + offset + "-" + (end - 1) + "/" + total;
  }

  function isFinalStatus(status) { return status === 200 || status === 201; }
  function isResumeStatus(status) { return status === 308; }
  // 일시적 오류 → 재시도: 네트워크(0)·429·5xx. 4xx(308 제외)는 치명적.
  function isRetriableStatus(status) {
    return status === 0 || status === 429 || (status >= 500 && status <= 599);
  }

  function defaultSleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // 재시도 무의미한 치명적 오류(4xx·무결성 실패) — 재시도 루프를 빠져나가게 표시.
  function fatal(message) {
    var e = new Error(message);
    e.fatal = true;
    return e;
  }

  // ── 메인: resumable 업로드 ────────────────────────────────────
  // uploadUrl: drive-upload-url 이 발급한 세션 URL. file: Blob/File(또는 {size,slice}).
  // opts: { fetchImpl, sleep, chunkSize, maxRetries, baseDelay, contentType, onProgress }
  async function resumableUpload(uploadUrl, file, opts) {
    opts = opts || {};
    var doFetch = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!doFetch) throw new Error("fetch 구현이 필요합니다(fetchImpl)");
    var sleep = opts.sleep || defaultSleep;
    var total = Number(file && file.size) || 0;
    if (!total) throw new Error("빈 파일은 업로드할 수 없습니다");
    var chunkSize = alignChunkSize(opts.chunkSize || DEFAULT_CHUNK);
    var maxRetries = Number(opts.maxRetries) || DEFAULT_MAX_RETRIES;
    var baseDelay = Number(opts.baseDelay) || DEFAULT_BASE_DELAY;
    var contentType = opts.contentType || (file && file.type) || "application/octet-stream";
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

    var offset = 0;

    while (offset < total) {
      var end = Math.min(offset + chunkSize, total);
      var lastError = null;
      var done = false;

      for (var attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          var res = await doFetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": contentType,
              "Content-Range": contentRange(offset, end, total)
            },
            body: file.slice(offset, end)
          });
          var status = res.status;

          if (isFinalStatus(status)) {
            var meta = await res.json();
            // 무결성: fileId 필수 + size 가 오면 총 바이트와 일치해야 함.
            if (!meta || !meta.id) throw fatal("업로드 응답에 fileId 없음");
            if (meta.size != null && Number(meta.size) !== total) {
              throw fatal("업로드 크기 불일치: 기대 " + total + " / 실제 " + meta.size);
            }
            if (onProgress) onProgress(total, total);
            return meta;
          }

          if (isResumeStatus(status)) {
            // 서버가 청크 수신 ACK → 확정된 끝(Range)부터 다음 청크.
            var confirmed = nextOffsetFromRange(res.headers && res.headers.get && res.headers.get("Range"));
            offset = confirmed > offset ? confirmed : end; // 진전 없으면 계산상 end 로 전진(무한루프 방지)
            if (onProgress) onProgress(offset, total);
            done = true;
            break;
          }

          if (isRetriableStatus(status)) {
            lastError = new Error("업로드 일시 오류(status " + status + ")");
          } else {
            // 4xx 치명적 — 재시도 무의미.
            var bodyTxt = "";
            try { bodyTxt = await res.text(); } catch (_) { /* ignore */ }
            throw fatal("업로드 실패(status " + status + ")" + (bodyTxt ? ": " + bodyTxt.slice(0, 200) : ""));
          }
        } catch (err) {
          if (err && err.fatal) throw err; // 치명적 오류는 재시도하지 않고 즉시 전파
          lastError = err;                 // 네트워크 등 일시 오류만 재시도
        }

        if (attempt < maxRetries) {
          // 재시도 전, 서버가 이미 받은 바이트를 질의해 빠진 부분만 보내도록 offset 보정.
          try {
            var probe = await doFetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Range": "bytes */" + total }
            });
            if (isFinalStatus(probe.status)) {
              var m2 = await probe.json();
              if (m2 && m2.id) { if (onProgress) onProgress(total, total); return m2; }
            } else if (isResumeStatus(probe.status)) {
              var got = nextOffsetFromRange(probe.headers && probe.headers.get && probe.headers.get("Range"));
              if (got > offset) { offset = got; if (onProgress) onProgress(offset, total); }
            }
          } catch (_) { /* 질의 실패는 무시하고 그냥 재시도 */ }
          await sleep(backoffDelay(attempt, baseDelay));
        }
      }

      if (!done) {
        throw lastError || new Error("청크 업로드 재시도 소진(offset " + offset + ")");
      }
    }

    // total 도달까지 final(200/201)을 못 받은 비정상 종료.
    throw new Error("업로드가 완료 응답 없이 종료됨");
  }

  var StellaResumable = {
    resumableUpload: resumableUpload,
    // 헬퍼 노출(테스트/재사용)
    alignChunkSize: alignChunkSize,
    parseRangeEnd: parseRangeEnd,
    nextOffsetFromRange: nextOffsetFromRange,
    backoffDelay: backoffDelay,
    contentRange: contentRange,
    isFinalStatus: isFinalStatus,
    isResumeStatus: isResumeStatus,
    isRetriableStatus: isRetriableStatus,
    MIN_GRANULARITY: MIN_GRANULARITY,
    DEFAULT_CHUNK: DEFAULT_CHUNK
  };

  global.StellaResumable = StellaResumable;
  if (typeof module !== "undefined" && module.exports) module.exports = StellaResumable;
})(typeof globalThis !== "undefined" ? globalThis : this);
