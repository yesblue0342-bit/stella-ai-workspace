// lib/drive-files.mjs — 에이전트 생성 산출물을 Google Drive(StellaGPT/0Program)에 저장.
// 기존 Drive 인증/헬퍼(lib/drive-utils.js) 재사용 — 새 키·라우트·외부 저장소 없음. 비공개 보장(공개 GitHub 노출 회피).
import { getDrive, ensurePath, driveFileLink, FOLDER_MIME } from "./drive-utils.js";

const BASE_FOLDER = "0Program"; // StellaGPT/0Program (GitHub 0Program 레포와 폴더명 일치). (이전: 0download)

function cleanSeg(s) {
  return String(s == null ? "" : s).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "file";
}
function ymdKST(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return "" + k.getUTCFullYear() + String(k.getUTCMonth() + 1).padStart(2, "0") + String(k.getUTCDate()).padStart(2, "0");
}
const TEXT_EXT = /\.(txt|md|csv|tsv|json|js|mjs|cjs|ts|jsx|tsx|html|htm|css|xml|yml|yaml|abap|py|java|c|h|cpp|go|rb|php|rs|sql|sh|ini|toml)$/i;
function mimeFor(name) {
  if (TEXT_EXT.test(name)) return "text/plain; charset=utf-8";
  const ext = String(name).toLowerCase().split(".").pop();
  const M = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf", zip: "application/zip" };
  return M[ext] || "text/plain; charset=utf-8";
}

// content가 base64({encoding:'base64'})면 Buffer로, 아니면 문자열 그대로.
function toBody(f) {
  if (f.encoding === "base64" && typeof f.content === "string") {
    return { body: Buffer.from(f.content, "base64"), binary: true };
  }
  return { body: typeof f.content === "string" ? f.content : Buffer.from(f.content || []), binary: false };
}

// files: [{path, content, encoding?}]  →  StellaGPT/0download/<YYYYMMDD>/<title>/<상대경로>
export async function saveAgentFilesToDrive({ files, title, source = "claude-code" }) {
  const drive = getDrive();
  const ymd = ymdKST();
  const titleSeg = cleanSeg(title || "session");
  const rootFolder = await ensurePath([BASE_FOLDER, ymd, titleSeg]);

  // 디렉터리별 폴더 캐시(중복 ensurePath 호출 절감)
  const folderCache = new Map(); // relDir -> folderId
  folderCache.set("", rootFolder.id);
  async function folderFor(relDir) {
    if (folderCache.has(relDir)) return folderCache.get(relDir);
    const parts = relDir.split("/").filter(Boolean).map(cleanSeg);
    const f = await ensurePath([BASE_FOLDER, ymd, titleSeg, ...parts]);
    folderCache.set(relDir, f.id);
    return f.id;
  }

  const saved = [], errors = [];
  for (const f of (files || [])) {
    if (!f || !f.path || f.content == null) continue;
    try {
      const rel = String(f.path).replace(/^\/+/, "").replace(/\.\.+/g, "_"); // traversal 방지
      const name = cleanSeg(rel.split("/").pop() || "file");
      const dir = rel.includes("/") ? rel.replace(/\/[^/]*$/, "") : "";
      const parentId = await folderFor(dir);
      const { body } = toBody(f);
      const created = await drive.files.create({
        requestBody: { name, parents: [parentId] },
        media: { mimeType: mimeFor(name), body },
        fields: "id,name,webViewLink",
        supportsAllDrives: true,
      });
      saved.push({ path: rel, id: created.data.id, name: created.data.name, link: created.data.webViewLink || driveFileLink({ id: created.data.id }) });
    } catch (e) {
      errors.push({ path: f.path, error: String((e && e.message) || e) });
    }
  }

  const folderLink = driveFileLink({ id: rootFolder.id, mimeType: FOLDER_MIME });
  return {
    ok: saved.length > 0,
    source,
    folder: `StellaGPT/${BASE_FOLDER}/${ymd}/${titleSeg}`,
    folderId: rootFolder.id,
    folderLink,
    saved: saved.length,
    total: (files || []).length,
    files: saved,
    errors: errors.length ? errors : undefined,
  };
}

// ── C2: 작업 결과 전문을 StellaGPT/0download 에 단일 .txt로 저장 ──
// KST 기준 YYYYMMDD_HHMMSS (파일명용)
function tsKST(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return "" + k.getUTCFullYear() + p(k.getUTCMonth() + 1) + p(k.getUTCDate()) + "_" + p(k.getUTCHours()) + p(k.getUTCMinutes()) + p(k.getUTCSeconds());
}
// 순수 헬퍼(테스트 용): 파일명 = {앱명}_{YYYYMMDD_HHMMSS}.txt
function txtFileName(app, d = new Date()) {
  const base = cleanSeg(app || "Stella").replace(/\s+/g, "");
  return base + "_" + tsKST(d) + ".txt";
}
// 순수 헬퍼(테스트 용): 내용 = 요청 헤더 한 줄 + 빈 줄 + 결과 전문
function txtContent(header, text) {
  const h = String(header == null ? "" : header).replace(/\s+/g, " ").trim();
  const body = String(text == null ? "" : text);
  return (h ? ("[요청] " + h + "\n\n") : "") + body;
}
// app: 앱명, header: 작업 요청 한 줄, text: 생성 결과 전문
export async function saveTextToDrive({ app, header, text }) {
  const drive = getDrive();
  const folder = await ensurePath([BASE_FOLDER]); // StellaGPT/0download (날짜 하위폴더 없이 직접)
  const name = txtFileName(app);
  const content = txtContent(header, text);
  const created = await drive.files.create({
    requestBody: { name, parents: [folder.id] },
    media: { mimeType: "text/plain; charset=utf-8", body: content },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });
  return {
    ok: true,
    folder: `StellaGPT/${BASE_FOLDER}`,
    folderId: folder.id,
    fileId: created.data.id,
    name: created.data.name,
    link: created.data.webViewLink || driveFileLink({ id: created.data.id }),
  };
}

export { BASE_FOLDER, ymdKST, cleanSeg, tsKST, txtFileName, txtContent };
