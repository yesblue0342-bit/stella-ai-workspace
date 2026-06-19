// GET /api/gh-download — 임의 레포 파일을 토큰으로 받아 원본 바이트를 그대로 스트리밍.
// 큰 base64를 JSON에 싣지 않음 → "Failed to fetch"/0바이트 다운로드 방지.
// Content-Type + Content-Disposition(RFC 5987 한글 파일명) 부여. 에러는 항상 JSON.
// 토큰은 env에서만 읽고 응답/로그에 노출하지 않는다.

export const config = { maxDuration: 60 };

const MIME = {
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8", json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", ts: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", xml: "application/xml; charset=utf-8",
  abap: "text/plain; charset=utf-8", py: "text/plain; charset=utf-8", java: "text/plain; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
};
function mimeFor(name) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  return MIME[ext] || "application/octet-stream";
}
function clean(v) { return String(v || "").trim(); }
function ghToken() {
  return clean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN);
}
// path traversal / 민감파일 차단
function assertSafePath(path) {
  const p = clean(path).replace(/^\/+/, "");
  if (!p) { const e = new Error("path required"); e.status = 400; throw e; }
  if (p.includes("..") || p.startsWith(".git/") || p === ".env" || p.endsWith(".env") || p.includes("/.env")) {
    const e = new Error("보안상 접근할 수 없는 경로입니다."); e.status = 400; throw e;
  }
  return p;
}
function jsonErr(res, status, message) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json({ ok: false, message });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return jsonErr(res, 405, "GET only");
    const owner = clean(req.query?.owner), repo = clean(req.query?.repo);
    const ref = clean(req.query?.ref) || "main";
    if (!owner || !repo) return jsonErr(res, 400, "owner, repo required");
    let path;
    try { path = assertSafePath(req.query?.path); }
    catch (e) { return jsonErr(res, e.status || 400, e.message); }
    const name = path.split("/").pop() || "download";
    const disp = clean(req.query?.disp) === "inline" ? "inline" : "attachment";

    const token = ghToken();
    const headers = {
      "Accept": "application/vnd.github.raw", // 원본 바이트 직접 (최대 100MB, base64 아님)
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "stella-hub",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      let msg = `GitHub ${r.status}`;
      try { const j = await r.json(); if (j && j.message) msg += ": " + j.message; } catch {}
      if (r.status === 403 && /rate limit/i.test(msg)) msg = "GitHub API 요청 한도 초과. 잠시 후 다시 시도하세요.";
      if (r.status === 404) msg = "파일을 찾을 수 없습니다(경로/브랜치 확인).";
      return jsonErr(res, r.status, msg);
    }
    const buf = Buffer.from(await r.arrayBuffer());

    // RFC 5987: ASCII fallback + UTF-8 인코딩(한글 파일명)
    const asciiName = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.setHeader("Content-Type", mimeFor(name));
    res.setHeader("Content-Disposition", `${disp}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    return res.status(200).send(buf);
  } catch (e) {
    return jsonErr(res, e.status || 500, "다운로드 실패: " + String(e.message || e));
  }
}
