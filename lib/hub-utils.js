/*
 * Stella Hub 유틸 (GitHub 브라우저) — 순수 함수. 브라우저(globalThis.StellaHub) + Node 테스트 공용.
 */
(function (global) {
  "use strict";

  var TEXT_EXT = ["md","txt","json","js","mjs","cjs","ts","jsx","tsx","html","htm","css","py","java","abap","sql","sh","yml","yaml","xml","csv","c","cpp","h","go","rb","php","rs","kt","gradle","properties","gitignore","env","log","ini","toml"];
  var IMAGE_EXT = ["png","jpg","jpeg","gif","webp","svg","bmp","ico"];

  function ext(name){
    var s = String(name || "");
    var i = s.lastIndexOf(".");
    return i >= 0 ? s.slice(i + 1).toLowerCase() : "";
  }
  function isTextFile(name){ return TEXT_EXT.indexOf(ext(name)) >= 0 || /^(readme|license|dockerfile|makefile)$/i.test(String(name||"")); }
  function isImageFile(name){ return IMAGE_EXT.indexOf(ext(name)) >= 0; }
  // 미리보기 분류
  function classify(name){ return isImageFile(name) ? "image" : (isTextFile(name) ? "text" : "binary"); }

  // raw.githubusercontent.com 직접 URL (다운로드/미리보기)
  function rawUrl(owner, repo, branch, path){
    var p = String(path || "").split("/").map(encodeURIComponent).join("/");
    return "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + (branch || "main") + "/" + p;
  }

  // RFC 5987: 한글 등 비ASCII 파일명을 Content-Disposition / download 용으로 인코딩
  function rfc5987(filename){
    return "UTF-8''" + encodeURIComponent(String(filename || "file"))
      .replace(/['()*]/g, function(c){ return "%" + c.charCodeAt(0).toString(16).toUpperCase(); })
      .replace(/%(7C|60|5E)/g, function(s, h){ return String.fromCharCode(parseInt(h, 16)); });
  }

  // 클라이언트 측 파일명 필터 (대소문자 무시)
  function filterFiles(items, q){
    var key = String(q || "").trim().toLowerCase();
    if (!key) return (items || []).slice();
    return (items || []).filter(function(it){ return String(it.name || "").toLowerCase().indexOf(key) >= 0; });
  }

  // contents 항목 정렬: 폴더 먼저, 그다음 이름순
  function sortContents(items){
    return (items || []).slice().sort(function(a, b){
      var da = a.type === "dir" ? 0 : 1, db = b.type === "dir" ? 0 : 1;
      if (da !== db) return da - db;
      return String(a.name||"").localeCompare(String(b.name||""), "en");
    });
  }

  // GitHub 비인증 rate-limit 응답 감지(403 + rate limit)
  function isRateLimited(status, body){
    if (status !== 403) return false;
    var msg = (body && (body.message || "")) || "";
    return /rate limit/i.test(msg);
  }

  var StellaHub = { ext, isTextFile, isImageFile, classify, rawUrl, rfc5987, filterFiles, sortContents, isRateLimited, OWNER: "yesblue0342-bit" };
  global.StellaHub = StellaHub;
  if (typeof module !== "undefined" && module.exports) module.exports = StellaHub;
})(typeof globalThis !== "undefined" ? globalThis : this);
