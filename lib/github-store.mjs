// lib/github-store.mjs — 0Program 저장/로드 (서버사이드 전용). PAT는 env에서만 읽는다(여러 이름 폴백).
const GH_API = "https://api.github.com";

// PAT는 이미 Vercel 환경변수에 존재. 변수명 폴백만 맞춘다(새 토큰 발급/추가 금지).
export function ghToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GH_PAT
    || process.env.GITHUB_PAT || process.env.GITHUB_API_KEY || process.env.STELLA_GITHUB_TOKEN || "";
}
export function hasGhToken() { return !!ghToken(); }

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
