// lib/drive/file-text.js — 다운로드한 버퍼에서 텍스트를 뽑는 포맷별 추출기.
// lib/drive-utils.js 분리의 일부. 네트워크 의존 0 (버퍼 in → 텍스트 out) → 단위 테스트 가능.

import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { createRequire } from "module";

// CJS 패키지를 ESM 환경에서 안전하게 로드 (type:module 대응)
const _require = createRequire(import.meta.url);
function loadMammoth() {
  try { return _require("mammoth"); } catch (e) { return null; }
}
// pdf-parse는 제거됨 (빌드 깨짐 유발) - PDF는 순수 JS로 추출

const XML_ENTITIES = [
  [/&amp;/g, "&"], [/&lt;/g, "<"], [/&gt;/g, ">"], [/&quot;/g, '"'], [/&#39;/g, "'"], [/&apos;/g, "'"],
];
function decodeEntities(s) {
  return XML_ENTITIES.reduce((acc, [re, ch]) => acc.replace(re, ch), s);
}

export function bufferToText(buffer) {
  return Buffer.from(buffer || []).toString("utf8");
}

/** 남은 태그를 걷어내고 공백을 정규화한다(pptx 슬라이드 텍스트용). */
export function stripXml(xml = "") {
  return decodeEntities(
    String(xml || "")
      .replace(/<a:t>/g, "")
      .replace(/<\/a:t>/g, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

export function extractXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts = [];
  for (const sheetName of wb.SheetNames.slice(0, 20)) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false });
    const lines = rows.slice(0, 500).map((row) => row.map((v) => String(v ?? "").trim()).join("\t")).filter(Boolean);
    if (lines.length) parts.push(`[Sheet: ${sheetName}]\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

// mammoth(CJS)가 로드되면 그걸 쓰고, 실패하면 fflate로 word/*.xml을 직접 파싱한다(외부 의존성 없음).
export async function extractDocx(buffer) {
  try {
    const mammoth = loadMammoth();
    if (mammoth) {
      try {
        const r = await mammoth.extractRawText({ buffer });
        if (r && r.value && r.value.trim()) return r.value;
      } catch (e1) { /* ArrayBuffer 방식으로 재시도 */ }
      try {
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const r = await mammoth.extractRawText({ arrayBuffer });
        if (r && r.value && r.value.trim()) return r.value;
      } catch (e2) { /* fflate 폴백으로 */ }
    }
  } catch (e) { /* mammoth 미설치 — fflate 폴백 */ }

  try {
    const zip = unzipSync(new Uint8Array(buffer));
    // document.xml 외에 header/footer도 포함
    const xmlKeys = Object.keys(zip).filter((k) => k === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(k));
    const allTexts = [];
    for (const key of xmlKeys) {
      // </w:p> = 문단 끝 = 줄바꿈
      for (const para of strFromU8(zip[key]).split(/<\/w:p>/)) {
        const texts = [];
        const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let m;
        while ((m = re.exec(para)) !== null) {
          if (m[1]) texts.push(m[1]);
        }
        const line = texts.join("").trim();
        if (line) allTexts.push(line);
      }
    }
    if (allTexts.length) return decodeEntities(allTexts.join("\n"));
  } catch (e2) {
    console.error("[drive/file-text] docx fflate 추출 실패:", e2.message);
  }
  return "";
}

// PDF 스트림에서 텍스트 직접 추출 (순수 JS, 외부 패키지 불필요)
export function extractPdf(buffer) {
  try {
    const str = buffer.toString("latin1");
    const texts = [];
    const re = /BT[\s\S]*?ET/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const block = m[0];
      // (text) Tj 형식
      for (const t of block.match(/\(([^)]*)\)\s*Tj/g) || []) {
        const inner = t.match(/\(([^)]*)\)/);
        if (inner && inner[1].trim()) texts.push(inner[1]);
      }
      // [(text)-spacing(text)] TJ 형식
      for (const t of block.match(/\[([^\]]*)\]\s*TJ/g) || []) {
        for (const p of t.match(/\(([^)]*)\)/g) || []) {
          const inner = p.replace(/^\(|\)$/g, "");
          if (inner.trim()) texts.push(inner);
        }
      }
    }
    if (texts.length > 0) {
      return texts.join(" ").replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ").trim();
    }
  } catch (e2) { /* 손상된 PDF — 빈 문자열로 "읽지 못함" 처리 */ }
  return "";
}

export function extractPptx(buffer) {
  const zip = unzipSync(new Uint8Array(buffer));
  const slideKeys = Object.keys(zip)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));

  return slideKeys
    .map((key, i) => {
      const text = stripXml(strFromU8(zip[key]));
      return text ? `[Slide ${i + 1}]\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

const TEXTUAL_EXT = /\.(txt|csv|json|xml|html|htm|md|js|ts|css|sql|abap)$/i;
const SHEET_EXT = /\.(xlsx|xls|xlsm|csv)$/i;

/** Drive 파일(메타 + 버퍼)에서 텍스트를 뽑는다. 미지원 형식이면 빈 문자열. */
export async function extractRegularFileText(file, buffer) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.mimeType || "").toLowerCase();

  if (TEXTUAL_EXT.test(name) || /^text\//.test(mime) || /json|xml|csv|javascript|html/.test(mime)) return bufferToText(buffer);
  if (SHEET_EXT.test(name) || /spreadsheet|excel/.test(mime)) return extractXlsx(buffer);
  if (/\.docx$/i.test(name) || /wordprocessingml/.test(mime)) return extractDocx(buffer);
  if (/\.pdf$/i.test(name) || mime === "application/pdf") return extractPdf(buffer);
  if (/\.pptx$/i.test(name) || /presentationml/.test(mime)) return extractPptx(buffer);
  return "";
}

/**
 * 텍스트 추출이 가능한 형식인가 — extractRegularFileText가 실제로 처리하는 집합과 동일하게 유지.
 * (mp4/png/zip 등은 전체 다운로드해도 빈 문자열이라 다운로드 자체를 건너뛰기 위한 사전 판정)
 */
export function isExtractableDriveFile(file = {}) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.mimeType || "").toLowerCase();
  if (mime.startsWith("application/vnd.google-apps.")) return true; // Docs/Sheets/Slides는 export로 처리
  return /\.(txt|csv|json|xml|html|htm|md|js|ts|css|sql|abap|xlsx|xls|xlsm|docx|pdf|pptx)$/i.test(name)
    || /^text\//.test(mime)
    || /json|xml|csv|javascript|html|spreadsheet|excel|wordprocessingml|presentationml/.test(mime)
    || mime === "application/pdf";
}
