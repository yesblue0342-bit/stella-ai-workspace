// GET /api/gh-export-excel — 파일이 정상적으로 안 열릴 때 "Excel로 내보내기" 폴백.
// 텍스트/CSV/TSV/JSON → .xlsx 시트. 바이너리 → 메타+내용요약 시트. 항상 열리는 결과 보장(실패 시 CSV).
// SheetJS(xlsx)는 deps에 존재. 토큰은 env에서만.

import * as XLSXns from "xlsx";
const XLSX = XLSXns.default || XLSXns;
const MAX_BYTES = 6 * 1024 * 1024; // 과대 파일 보호
function clean(v) { return String(v || "").trim(); }
function ghToken() { return clean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN); }
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
const TEXT_EXT = ["txt", "md", "csv", "tsv", "json", "js", "mjs", "ts", "html", "css", "xml", "abap", "py", "java", "log", "yml", "yaml", "sql", "sh"];
function extOf(name) { return String(name || "").toLowerCase().split(".").pop(); }
function looksText(buf) { // 첫 1KB에 NUL 없으면 텍스트로 간주
  const n = Math.min(buf.length, 1024);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function buildWorkbook(name, buf) {
  const ext = extOf(name);
  const wb = XLSX.utils.book_new();
  const isText = TEXT_EXT.includes(ext) || looksText(buf);

  if (isText) {
    const text = buf.toString("utf8");
    if (ext === "json") {
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data) && data.length && typeof data[0] === "object") {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "JSON");
          return wb;
        }
        const rows = Object.entries(flatten(data)).map(([k, v]) => ({ key: k, value: typeof v === "object" ? JSON.stringify(v) : v }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ key: "(empty)", value: "" }]), "JSON");
        return wb;
      } catch { /* JSON 파싱 실패 → 일반 텍스트로 */ }
    }
    if (ext === "csv" || ext === "tsv") {
      const sep = ext === "tsv" ? "\t" : ",";
      const aoa = text.split(/\r?\n/).map(line => line.split(sep));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), ext.toUpperCase());
      return wb;
    }
    // 일반 텍스트/코드: 줄 단위 1열
    const aoa = text.split(/\r?\n/).map((line, i) => [i + 1, line]);
    aoa.unshift(["line", "content"]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "TEXT");
    return wb;
  }

  // 바이너리: 메타 + 내용 요약(base64 head)
  const meta = [
    { field: "filename", value: name },
    { field: "size_bytes", value: buf.length },
    { field: "type", value: "binary" },
    { field: "note", value: "원본 바이너리는 Excel로 표현 불가. 메타와 base64 미리보기만 포함." },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), "META");
  const b64 = buf.toString("base64");
  const chunks = b64.match(/.{1,120}/g) || [];
  const aoa = chunks.slice(0, 2000).map((c, i) => [i, c]);
  aoa.unshift(["chunk", "base64"]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "BASE64");
  return wb;
}
function flatten(obj, prefix = "", out = {}) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? prefix + "." + k : k, out);
  } else out[prefix || "value"] = obj;
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return jsonErr(res, 405, "GET only");
    const owner = clean(req.query?.owner), repo = clean(req.query?.repo), ref = clean(req.query?.ref) || "main";
    if (!owner || !repo) return jsonErr(res, 400, "owner, repo required");
    let path;
    try { path = assertSafePath(req.query?.path); } catch (e) { return jsonErr(res, e.status || 400, e.message); }
    const name = path.split("/").pop() || "export";

    const headers = { "Accept": "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "stella-hub" };
    const token = ghToken(); if (token) headers.Authorization = `Bearer ${token}`;
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      let msg = `GitHub ${r.status}`; try { const j = await r.json(); if (j && j.message) msg += ": " + j.message; } catch {}
      return jsonErr(res, r.status, msg);
    }
    let buf = Buffer.from(await r.arrayBuffer());
    let truncated = false;
    if (buf.length > MAX_BYTES) { buf = buf.subarray(0, MAX_BYTES); truncated = true; }

    const base = name.replace(/\.[^.]+$/, "") || "export";
    const asciiName = (base + ".xlsx").replace(/[^\x20-\x7e]/g, "_");

    try {
      const wb = buildWorkbook(name, buf);
      const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(base + ".xlsx")}`);
      if (truncated) res.setHeader("X-Truncated", "1");
      return res.status(200).send(out);
    } catch (e) {
      // xlsx 생성 실패 → CSV 폴백(엑셀에서 열림)
      const text = looksText(buf) ? buf.toString("utf8") : buf.toString("base64");
      const csv = "content\n" + text.split(/\r?\n/).map(l => '"' + l.replace(/"/g, '""') + '"').join("\n");
      const csvAscii = (base + ".csv").replace(/[^\x20-\x7e]/g, "_");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${csvAscii}"; filename*=UTF-8''${encodeURIComponent(base + ".csv")}`);
      return res.status(200).send("﻿" + csv); // BOM: 엑셀 한글 깨짐 방지
    }
  } catch (e) {
    return jsonErr(res, e.status || 500, "Excel 내보내기 실패: " + String(e.message || e));
  }
}
