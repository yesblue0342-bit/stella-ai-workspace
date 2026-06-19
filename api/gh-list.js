// GET /api/gh-list?repo=owner/name&path=&ref= — 디렉터리 목록(JSON). 브라우저는 GitHub 직접 호출 안 함.
import { applyCors, isAllowedRepo, parseRepo, getRepoMeta, checkPrivateGate, assertSafePath, ghToken, jsonErr, withTimeout, clean } from "../lib/gh-proxy.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return jsonErr(res, 405, "GET only");
  const { signal, done } = withTimeout(20000);
  try {
    const repo = clean(req.query?.repo);
    if (!isAllowedRepo(repo)) return jsonErr(res, 403, "허용되지 않은 repo입니다(allowlist).");
    const { owner, name } = parseRepo(repo);
    const path = assertSafePath(req.query?.path || "");
    const meta = await getRepoMeta(owner, name, signal);
    checkPrivateGate(req, meta.private);
    const ref = clean(req.query?.ref) || meta.default_branch;

    const token = ghToken();
    const headers = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "stella-proxy" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const p = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${p}?ref=${encodeURIComponent(ref)}`;
    const r = await fetch(url, { headers, signal });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) {
      if ((r.status === 404 || r.status === 409) && /empty/i.test((data && data.message) || "") && !p) {
        return res.status(200).json({ ok: true, repo, ref, type: "dir", items: [], empty: true, message: "빈 레포지토리입니다." });
      }
      return jsonErr(res, r.status, (data && data.message) || `GitHub ${r.status}`);
    }
    if (Array.isArray(data)) {
      const items = data.map(x => ({ name: x.name, path: x.path, type: x.type, sha: x.sha, size: x.size || 0 }));
      return res.status(200).json({ ok: true, repo, ref, type: "dir", items });
    }
    // 단일 파일 경로면 메타만
    return res.status(200).json({ ok: true, repo, ref, type: "file", name: data.name, path: data.path, sha: data.sha, size: data.size || 0 });
  } catch (e) {
    return jsonErr(res, e.status || 500, "목록 조회 실패: " + String(e.message || e));
  } finally { done(); }
}
