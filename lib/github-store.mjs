// lib/github-store.mjs — 0Program 저장/로드 (서버사이드 전용). PAT는 env에서만 읽는다(여러 이름 폴백).
const GH_API = "https://api.github.com";

// PAT는 이미 서버 환경변수에 존재. 변수명 폴백만 맞춘다(새 토큰 발급/추가 금지).
export function ghToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GH_PAT
    || process.env.GITHUB_PAT || process.env.GITHUB_API_KEY || process.env.STELLA_GITHUB_TOKEN || "";
}
export function hasGhToken() { return !!ghToken(); }

// 소스 텍스트에서 ABAP 프로그램명 추출(채팅 제목/프롬프트 대신). 못 찾으면 program_<타임스탬프>.
function _tsName() {
  const d = new Date(new Date().getTime() + 9 * 3600 * 1000); // KST
  const p = (n) => String(n).padStart(2, "0");
  return `program_${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
function _clipName(n) {
  const c = String(n || "").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 40);
  return c || _tsName();
}
export function deriveAbapName(text) {
  const s = String(text || "");
  let m;
  // 1) REPORT / PROGRAM / FUNCTION-POOL
  m = s.match(/\b(?:REPORT|PROGRAM|FUNCTION-POOL)\s+([A-Za-z_]\w*)/i); if (m) return _clipName(m[1]);
  // 2) CLASS zcl_… / INTERFACE zif_…
  m = s.match(/\b(?:CLASS|INTERFACE)\s+([A-Za-z_]\w*)/i); if (m) return _clipName(m[1]);
  // 3) FORM / METHOD
  m = s.match(/\b(?:FORM|METHOD)\s+([A-Za-z_]\w*)/i); if (m) return _clipName(m[1]);
  // 4) 첫 Z/Y 식별자
  m = s.match(/\b([ZYzy][A-Za-z0-9_]{2,})\b/); if (m) return _clipName(m[1]);
  return _tsName();
}
// programName이 비었거나 한글문장(공백 포함 / Z·Y 미시작)이면 소스에서 추출한 이름으로 대체.
export function resolveProgramName(programName, text) {
  const pn = String(programName || "").trim();
  if (!pn || /\s/.test(pn) || !/^[ZYzy]/.test(pn)) return deriveAbapName(text);
  return pn;
}

// 코드펜스 언어 → 파일 확장자. (소스 실제 언어 반영)
export const LANG_EXT = {
  abap: "abap", py: "py", python: "py", js: "js", javascript: "js", jsx: "jsx", mjs: "mjs",
  ts: "ts", typescript: "ts", tsx: "tsx", java: "java", kotlin: "kt", kt: "kt",
  sql: "sql", json: "json", xml: "xml", html: "html", htm: "html", css: "css", scss: "scss",
  c: "c", "c++": "cpp", cpp: "cpp", "c#": "cs", csharp: "cs", cs: "cs", go: "go", golang: "go",
  rb: "rb", ruby: "rb", php: "php", sh: "sh", bash: "sh", shell: "sh", ps1: "ps1", powershell: "ps1",
  yaml: "yaml", yml: "yaml", md: "md", markdown: "md", r: "r", swift: "swift", rust: "rs", rs: "rs",
  dart: "dart", scala: "scala", pl: "pl", perl: "pl", lua: "lua", vue: "vue", txt: "txt", text: "txt",
};
const _IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "ico", "tif", "tiff", "avif"]);

// 첫 코드펜스의 언어 토큰 → 확장자. 없으면 "".
export function fenceExtFromText(text) {
  const m = String(text || "").match(/```\s*([A-Za-z0-9#+_.\-]+)/);
  if (m) { const l = m[1].toLowerCase().replace(/^\.+/, ""); if (LANG_EXT[l]) return LANG_EXT[l]; }
  return "";
}

// 저장 확장자 결정: ① 첨부/명시 확장자(이미지 제외) → ② 코드펜스 언어 → ③ ABAP 키워드 → ④ txt.
export function resolveExt(rawExt, text) {
  const e = String(rawExt || "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8);
  if (e && !_IMG_EXT.has(e)) return e;                 // 첨부한 소스 파일 확장자 우선(이미지 확장자는 소스로 부적합 → 제외)
  const fe = fenceExtFromText(text); if (fe) return fe; // 생성된 코드의 실제 언어
  if (text && /\b(REPORT|FUNCTION-POOL|FORM|ENDFORM|METHOD|ENDMETHOD|DATA:|CLASS\s+\w+\s+DEFINITION|TYPE\s+REF\s+TO)\b/i.test(String(text))) return "abap";
  return "txt";
}

export function toRepoPath(name, ext = "abap", dir = "src") {
  // 후행 점/공백 제거(`..txt` 방지) + 비허용문자 치환 + 과도한 길이 제한(요청문장이 파일명이 되는 문제 방지).
  let safe = String(name || "").trim()
    .replace(/[\s.]+$/g, "")                 // 후행 점/공백 제거
    .replace(/[^\w.\-가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")                   // 연속 _ 축약
    .slice(0, 60).replace(/[._-]+$/g, "");    // 60자 제한 + 끝의 구분자 정리
  if (!safe) safe = `program_${Date.now()}`;
  const base = safe.toLowerCase().endsWith("." + ext.toLowerCase()) ? safe : `${safe}.${ext}`;
  return dir ? `${dir}/${base}` : base;
}
export function toBase64(text) { return Buffer.from(String(text ?? ""), "utf-8").toString("base64"); }
export function fromBase64(b64) { return Buffer.from(String(b64 ?? ""), "base64").toString("utf-8"); }
export function buildPutBody({ message, content, branch = "main", sha } = {}) {
  const body = { message: message || "auto: update source", content: toBase64(content), branch };
  if (sha) body.sha = sha;
  return body;
}
export function parseShaFromContents(data) { return data && typeof data.sha === "string" ? data.sha : null; }

function ghHeaders() {
  return {
    Authorization: `Bearer ${ghToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}
export async function loadFromGitHub({ owner, repo, path, branch = "main" }) {
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return { exists: false, sha: null, text: null };
  if (!r.ok) throw new Error(`GitHub GET ${r.status}`);
  const data = await r.json();
  return { exists: true, sha: parseShaFromContents(data), text: fromBase64(data.content) };
}

// 실제 프로젝트 폴더(예: 260701_QM004_.../_abap/ZAQMR0100.abap)에서 프로그램명으로 파일 탐색.
// src/<name>.abap 평면 스크래치 경로보다 실제 조직화된 프로젝트 폴더를 우선한다.
// 정확히 "<name>.abap"(대소문자 무시) 파일명과 일치하는 것만 대상 — Include(_F01 등) 오매칭 방지.
export async function findProgramPath({ owner, repo, name, branch = "main" }) {
  const wantBase = `${String(name || "").toLowerCase()}.abap`;
  const url = `${GH_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) return null;
  const data = await r.json();
  const blobs = (data.tree || []).filter((t) => t.type === "blob");
  const matches = blobs.filter((t) => String(t.path.split("/").pop() || "").toLowerCase() === wantBase);
  if (!matches.length) return null;
  // src/ 스크래치 경로보다 실제 프로젝트 폴더(_abap/ 등) 우선.
  matches.sort((a, b) => {
    const aScratch = a.path.startsWith("src/") ? 1 : 0;
    const bScratch = b.path.startsWith("src/") ? 1 : 0;
    if (aScratch !== bScratch) return aScratch - bScratch;
    return a.path.length - b.path.length; // 동률이면 더 짧은(상위) 경로 우선
  });
  return matches[0].path;
}
export async function saveToGitHub({ owner, repo, path, content, message, branch = "main" }) {
  let sha = null;
  try { const cur = await loadFromGitHub({ owner, repo, path, branch }); sha = cur.sha; } catch {}
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT", headers: ghHeaders(),
    body: JSON.stringify(buildPutBody({ message, content, branch, sha })),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

// STEP E: 빈 레포(커밋 0) 부트스트랩 — 첫 PUT이 브랜치 부재로 실패하면 README로 main 생성 후 재시도.
export async function saveToGitHubBootstrap(opts) {
  try {
    return await saveToGitHub(opts);
  } catch (e) {
    // README.md 초기 커밋으로 main 생성 시도(이미 있으면 무해), 그 뒤 원래 저장 재시도.
    try {
      await saveToGitHub({
        owner: opts.owner, repo: opts.repo, path: "README.md", branch: opts.branch || "main",
        content: "# 0Program\n\nStella 소스 보관(Agent Code/ABAP/Codex 자동 저장).\n",
        message: "auto: init 0Program",
      });
    } catch (_) { /* 이미 존재 등 무시 */ }
    return await saveToGitHub(opts); // 재시도(실패하면 호출부에서 비차단 처리)
  }
}
