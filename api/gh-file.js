// GET /api/gh-file?repo=owner/name&path=&ref=&disp= — 파일 원본 스트리밍(차단망 우회).
// 폴더 zip: ?zip=1 → zipball 스트림 파이프(버퍼 안 함). 토큰은 env에서만, 클라이언트 노출 금지.
import { applyCors, isAllowedRepo, parseRepo, getRepoMeta, checkPrivateGate, assertSafePath, ghToken, jsonErr, withTimeout, clean } from "../lib/gh-proxy.mjs";
const MIME = {
  txt:"text/plain; charset=utf-8",md:"text/markdown; charset=utf-8",csv:"text/csv; charset=utf-8",tsv:"text/tab-separated-values; charset=utf-8",
  json:"application/json; charset=utf-8",js:"text/javascript; charset=utf-8",mjs:"text/javascript; charset=utf-8",ts:"text/plain; charset=utf-8",
  html:"text/html; charset=utf-8",css:"text/css; charset=utf-8",xml:"application/xml; charset=utf-8",abap:"text/plain; charset=utf-8",py:"text/plain; charset=utf-8",
  png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",bmp:"image/bmp",ico:"image/x-icon",
  pdf:"application/pdf",zip:"application/zip",gz:"application/gzip",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",xls:"application/vnd.ms-excel",
  mp3:"audio/mpeg",wav:"audio/wav",mp4:"video/mp4",webm:"video/webm",
};
function mimeFor(name){ const ext=String(name||"").toLowerCase().split(".").pop(); return MIME[ext]||"application/octet-stream"; }
function disposition(disp, name){
  const d = disp === "inline" ? "inline" : "attachment";
  const ascii = String(name||"download").replace(/[^\x20-\x7e]/g,"_").replace(/["\\]/g,"_");
  return `${d}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name||"download")}`;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return jsonErr(res, 405, "GET only");
  const { signal, done } = withTimeout(50000);
  try {
    const repo = clean(req.query?.repo);
    if (!isAllowedRepo(repo)) return jsonErr(res, 403, "허용되지 않은 repo입니다(allowlist).");
    const { owner, name } = parseRepo(repo);
    const meta = await getRepoMeta(owner, name, signal);
    checkPrivateGate(req, meta.private);
    const ref = clean(req.query?.ref) || meta.default_branch;
    const token = ghToken();

    // 폴더 zip 다운로드: zipball 스트림 파이프
    if (clean(req.query?.zip) === "1") {
      const headers = { "User-Agent": "stella-proxy" }; if (token) headers.Authorization = `Bearer ${token}`;
      const zurl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/zipball/${encodeURIComponent(ref)}`;
      const zr = await fetch(zurl, { headers, signal });
      if (!zr.ok || !zr.body) return jsonErr(res, zr.status || 502, `zip 받기 실패 ${zr.status}`);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", disposition("attachment", name + "-" + ref + ".zip"));
      res.setHeader("Cache-Control", "private, no-store");
      // web stream → node: 청크 단위로 흘려보내 4.5MB 버퍼 한계 회피
      const reader = zr.body.getReader();
      for (;;) { const { done: d2, value } = await reader.read(); if (d2) break; res.write(Buffer.from(value)); }
      return res.end();
    }

    const path = assertSafePath(req.query?.path);
    if (!path) return jsonErr(res, 400, "path required");
    const fileName = path.split("/").pop() || "download";
    // 원본 바이트: contents API raw (공개·비공개 모두, 최대 100MB). 토큰 있으면 비공개도.
    const headers = { "Accept": "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "stella-proxy" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
    const r = await fetch(url, { headers, signal });
    if (!r.ok) {
      let msg = `GitHub ${r.status}`; try { const j = await r.json(); if (j && j.message) msg += ": " + j.message; } catch {}
      if (r.status === 404) msg = "파일을 찾을 수 없습니다(경로/브랜치 확인).";
      return jsonErr(res, r.status, msg);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", mimeFor(fileName));
    res.setHeader("Content-Disposition", disposition(clean(req.query?.disp), fileName));
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(buf);
  } catch (e) {
    // zip 스트리밍 중(헤더 전송 후) 오류면 JSON을 쓸 수 없다 — jsonErr가 ERR_HTTP_HEADERS_SENT를
    // 던져 응답이 영영 안 닫히고, 클라이언트는 잘린 zip을 정상 다운로드로 오인한다.
    // → 소켓을 끊어 브라우저가 '네트워크 오류'로 명확히 실패 처리하게 한다.
    if (res.headersSent) {
      console.error('[gh-file] 스트리밍 중 오류:', String(e?.message || e));
      try { res.destroy(); } catch {}
      return;
    }
    return jsonErr(res, e.status || 500, "파일 프록시 실패: " + String(e.message || e));
  } finally { done(); }
}
