// api/gh-zip.js — 폴더(또는 레포 전체)를 ZIP으로 스트리밍 다운로드.
// 토큰(GITHUB_TOKEN)으로 비공개 레포도 접근. 압축은 fflate(이미 의존성).
// 호출: GET /api/gh-zip?owner=&repo=&path=&ref=
//   path 생략/빈값 → 레포 전체. path 지정 → 해당 폴더만.
import { zip } from "fflate";

function tok() {
  return String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN || "").trim();
}
function ghHeaders(token, accept) {
  const h = { "Accept": accept || "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "stella-hub" };
  if (token) h.Authorization = "Bearer " + token;
  return h;
}
async function ghJson(url, token) {
  const r = await fetch(url, { headers: ghHeaders(token) });
  const t = await r.text();
  let d; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t }; }
  if (!r.ok) { const e = new Error(d.message || ("GitHub " + r.status)); e.status = r.status; throw e; }
  return d;
}
function encPath(p) {
  return String(p || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}
// 파일 원본 바이트 (raw) — 모든 크기/바이너리 안전
async function ghRaw(owner, repo, path, ref, token) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath(path)}` + (ref ? `?ref=${encodeURIComponent(ref)}` : "");
  const r = await fetch(url, { headers: ghHeaders(token, "application/vnd.github.raw") });
  if (!r.ok) { const e = new Error("raw " + r.status); e.status = r.status; throw e; }
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const owner = String(q.owner || "").trim();
    const repo = String(q.repo || "").trim();
    const ref = String(q.ref || "main").trim() || "main";
    const path = String(q.path || "").trim().replace(/^\/+|\/+$/g, "");
    if (!owner || !repo) return res.status(400).json({ ok: false, message: "owner, repo required" });
    const token = tok();

    // 1) 전체 트리(recursive)로 파일 목록을 한 번에
    const treeUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const tree = await ghJson(treeUrl, token);
    let blobs = (tree.tree || []).filter((n) => n.type === "blob" && n.path);
    const prefix = path ? path + "/" : "";
    if (path) blobs = blobs.filter((n) => n.path === path || n.path.startsWith(prefix));
    if (!blobs.length) return res.status(404).json({ ok: false, message: "다운로드할 파일이 없습니다." });
    if (blobs.length > 2000) return res.status(413).json({ ok: false, message: "파일이 너무 많습니다(2000개 초과). 하위 폴더를 선택해 받으세요." });

    // 2) 각 파일 원본을 받아 zip 엔트리 구성
    const rootName = (path ? path.split("/").pop() : repo) || "archive";
    const files = {};
    for (const b of blobs) {
      try {
        const bytes = await ghRaw(owner, repo, b.path, ref, token);
        const rel = path ? b.path.slice(prefix.length) : b.path;
        files[rootName + "/" + rel] = bytes;
      } catch (e) { /* 개별 파일 실패는 건너뜀 */ }
    }
    if (!Object.keys(files).length) return res.status(502).json({ ok: false, message: "파일 내용을 가져오지 못했습니다." });

    // 3) fflate로 압축 후 스트리밍
    const zipped = await new Promise((resolve, reject) => {
      zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
    });

    const safe = rootName.replace(/[^\w.\-]/g, "_");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.zip"; filename*=UTF-8''` + encodeURIComponent(rootName) + ".zip");
    res.setHeader("Content-Length", zipped.length);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).end(Buffer.from(zipped));
  } catch (e) {
    if (!res.headersSent) return res.status(e.status || 500).json({ ok: false, message: e.message || "zip 생성 실패" });
  }
}
