// lib/codex-workspace.mjs — Stella Codex(OpenAI 백엔드) 무인 자동화용 임시 레포 워크스페이스.
// Anthropic Managed Agents 같은 호스팅 샌드박스가 OpenAI 쪽엔 없어, 이 서버(OCI) 프로세스가 직접
// git clone/commit/push 를 수행한다. 임의 bash 실행은 제공하지 않고(다른 Stella 앱과 같은 프로덕션
// 컨테이너 보호), list/read/write/delete + git_commit_and_push 로만 조작을 제한한다.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const execFileAsync = promisify(execFile);

function authHeader(token) {
  return "AUTHORIZATION: basic " + Buffer.from("x-access-token:" + token).toString("base64");
}

// 경로 탈출/민감파일 차단 — api/github.js assertSafePath 와 동일 정책.
export function safeRelPath(root, relPath) {
  const rel = String(relPath || "").replace(/^\/+/, "");
  if (!rel || rel === ".") return root;
  if (rel.includes("..") || rel === ".git" || rel.startsWith(".git/") || rel.includes("/.git/") ||
      rel === ".env" || rel.endsWith(".env") || rel.includes("/.env")) {
    const e = new Error("보안상 접근할 수 없는 경로입니다."); e.status = 400; throw e;
  }
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    const e = new Error("워크스페이스 밖 경로는 접근할 수 없습니다."); e.status = 400; throw e;
  }
  return abs;
}

async function git(cwd, token, args, opts = {}) {
  const cfgArgs = token ? ["-c", "http.extraheader=" + authHeader(token)] : [];
  const { stdout, stderr } = await execFileAsync("git", [...cfgArgs, ...args], {
    cwd, timeout: opts.timeout || 60000, maxBuffer: 10 * 1024 * 1024,
  });
  return (stdout || "") + (stderr || "");
}

// 세션마다 새 임시 디렉터리에 clone(토큰은 push/clone 네트워크 호출에만 헤더로 임시 사용, 디스크에 저장 안 함).
export async function createWorkspace({ owner, repo, branch, token }) {
  const base = await mkdtemp(join(tmpdir(), "stella-codex-"));
  const dir = join(base, "repo");
  const url = `https://github.com/${owner}/${repo}.git`;
  try {
    await git(base, token, ["clone", "--depth", "1", "--branch", branch || "main", "--single-branch", url, dir], { timeout: 90000 });
  } catch (e) {
    await rm(base, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
  return { root: dir, base, owner, repo, branch: branch || "main" };
}

export async function destroyWorkspace(ws) {
  if (!ws || !ws.base) return;
  try { await rm(ws.base, { recursive: true, force: true }); } catch { /* ignore */ }
}

export async function listDir(ws, relPath) {
  const abs = safeRelPath(ws.root, relPath);
  const entries = await readdir(abs, { withFileTypes: true });
  const names = entries.filter(e => e.name !== ".git").map(e => (e.isDirectory() ? e.name + "/" : e.name)).sort();
  return names.join("\n") || "(빈 디렉터리)";
}

export async function readFileRel(ws, relPath) {
  const abs = safeRelPath(ws.root, relPath);
  const s = await stat(abs).catch(() => null);
  if (!s || !s.isFile()) { const e = new Error("파일을 찾을 수 없습니다: " + relPath); e.status = 404; throw e; }
  if (s.size > 500000) { const e = new Error("파일이 너무 큽니다(500KB 초과): " + relPath); e.status = 413; throw e; }
  return readFile(abs, "utf8");
}

export async function writeFileRel(ws, relPath, content) {
  const abs = safeRelPath(ws.root, relPath);
  await mkdir(resolve(abs, ".."), { recursive: true });
  await writeFile(abs, String(content == null ? "" : content), "utf8");
  return "저장됨: " + relPath;
}

export async function deleteFileRel(ws, relPath) {
  const abs = safeRelPath(ws.root, relPath);
  await rm(abs, { force: true });
  return "삭제됨: " + relPath;
}

// add/commit 은 로컬 전용(토큰 불필요) — push 네트워크 호출에만 인증 헤더 사용(노출 표면 최소화).
export async function commitAndPush(ws, message, token) {
  await git(ws.root, null, ["add", "-A"]);
  const status = await git(ws.root, null, ["status", "--porcelain"]);
  if (!status.trim()) return "변경사항 없음(커밋 생략).";
  await git(ws.root, null, [
    "-c", "user.email=codex@stella.local", "-c", "user.name=Stella Codex",
    "commit", "-m", String(message || "Stella Codex 자동 커밋"),
  ]);
  const pushOut = await git(ws.root, token, ["push", "origin", "HEAD:" + ws.branch], { timeout: 90000 });
  return "커밋+push 완료: " + String(message || "").slice(0, 80) + "\n" + pushOut;
}

export default { safeRelPath, createWorkspace, destroyWorkspace, listDir, readFileRel, writeFileRel, deleteFileRel, commitAndPush };
