// POST /api/cc/save-github — 세션 산출물(생성 파일)을 GitHub 레포에 커밋 (PART B)
// { session } → 이벤트에서 파일 수집 → Contents API 커밋 → github_url 기록.
// GITHUB_TOKEN/시크릿은 env에서만 읽고 응답·로그에 절대 노출하지 않는다.
import { listEvents, normalizeEvents } from "./_maclient.mjs";
import { extractFilesFromEvents } from "../../lib/cc-files.mjs";
import { outputPath, commitMessage, ghPutFile, ymdKST, sanitizeSeg } from "../../lib/gh-commit.mjs";
import { getSessionRow, setSessionGithubUrl } from "../../lib/cc-db.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { session, files: bodyFiles } = req.body || {};
    if (!session) return res.status(400).json({ error: "session required" });

    const token = process.env.GITHUB_TOKEN;
    if (!token) return res.status(400).json({ error: "github_token_missing", message: "GITHUB_TOKEN 환경변수가 설정되지 않았습니다. Vercel 환경변수에 추가하세요." });
    const repo = process.env.CC_SAVE_REPO || "yesblue0342-bit/stella-ai-workspace";
    const branch = process.env.CC_SAVE_BRANCH || "main";

    const row = await getSessionRow(session).catch(() => null);
    const title = (row && row.title) || session;
    const ymd = ymdKST(new Date());

    // 파일 수집: 본문에 직접 주어지면 사용, 아니면 세션 이벤트에서 추출(폴백)
    let files = Array.isArray(bodyFiles) && bodyFiles.length ? bodyFiles : null;
    if (!files) {
      const raw = await listEvents(session);
      files = extractFilesFromEvents(normalizeEvents(raw));
    }
    files = (files || []).filter(f => f && f.path && f.content != null);
    if (!files.length) {
      return res.status(404).json({ error: "no_files", message: "이 세션에서 저장할 생성 파일을 찾지 못했습니다 (빈 커밋 방지)." });
    }

    const msg = commitMessage(ymd, title, files.length);
    const committed = [];
    const errors = [];
    for (const f of files) {
      const path = outputPath(ymd, title, f.path);
      try {
        const r = await ghPutFile({ repo, branch, path, content: f.content, message: msg, token });
        committed.push({ path, htmlUrl: r.htmlUrl });
      } catch (e) {
        errors.push({ path, error: String(e.message || e) }); // ghPutFile 에러엔 토큰 미포함
      }
    }

    const folderUrl = `https://github.com/${repo}/tree/${encodeURIComponent(branch)}/stella-agent-output/${ymd}/${encodeURIComponent(sanitizeSeg(title))}`;
    if (committed.length) { try { await setSessionGithubUrl(session, folderUrl); } catch {} }

    return res.status(committed.length ? 200 : 500).json({
      ok: committed.length > 0, committed: committed.length, total: files.length,
      files: committed, errors: errors.length ? errors : undefined, folderUrl, repo, branch,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "save_github_failed", message: String(e.message || e) });
  }
}
