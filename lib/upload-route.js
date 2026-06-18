/*
 * 업로드 경로 선택 (PART C1) — 순수 함수, 브라우저(globalThis.StellaUpload)+Node 공용.
 *
 * Vercel serverless 요청 본문 한도(~4.5MB) + base64 팽창(~33%) 때문에, 큰 파일을
 * base64로 /api/drive-upload 에 보내면 실패한다. 일정 크기 이상은 resumable 세션
 * (/api/drive-upload-url → Google에 직접 PUT)으로 보내 한도를 우회한다.
 */
(function (global) {
  "use strict";
  // raw 바이트 기준 임계값(기본 3MB): base64 시 약 4MB → Vercel 한도 안전 마진.
  var DEFAULT_RAW_LIMIT = 3 * 1024 * 1024;

  function useResumable(size, rawLimit) {
    var n = Number(size) || 0;
    var lim = Number(rawLimit) || DEFAULT_RAW_LIMIT;
    return n > lim;
  }

  var StellaUpload = { useResumable: useResumable, RAW_LIMIT: DEFAULT_RAW_LIMIT };
  global.StellaUpload = StellaUpload;
  if (typeof module !== "undefined" && module.exports) module.exports = StellaUpload;
})(typeof globalThis !== "undefined" ? globalThis : this);
