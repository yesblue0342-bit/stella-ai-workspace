const DEFAULT_REPO = "yesblue0342-bit/stella-ai-workspace";

function clean(value) {
  return String(value || "").trim();
}

function getConfig() {
  const token = clean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN);
  const repo = clean(process.env.GITHUB_REPO || process.env.GITHUB_REPOSITORY || process.env.STELLA_GITHUB_REPO) || DEFAULT_REPO;
  const branch = clean(process.env.GITHUB_BRANCH || process.env.STELLA_GITHUB_BRANCH) || "main";
  if (!token) {
    const error = new Error("GitHub 토큰 환경변수가 없습니다. Vercel에 GITHUB_TOKEN 또는 STELLA_GITHUB_TOKEN을 등록하세요.");
    error.status = 500;
    throw error;
  }
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    const error = new Error("GitHub 저장소 형식이 올바르지 않습니다. 예: yesblue0342-bit/stella-ai-workspace");
    error.status = 500;
    throw error;
  }
  return { token, repo, owner, name, branch };
}

function assertSafePath(path) {
  const p = clean(path).replace(/^\/+/, "");
  if (!p) {
    const error = new Error("수정할 파일 경로가 필요합니다.");
    error.status = 400;
    throw error;
  }
  if (p.includes("..") || p.startsWith(".git/") || p === ".env" || p.endsWith(".env") || p.includes("/.env")) {
    const error = new Error("보안상 수정할 수 없는 파일 경로입니다.");
    error.status = 400;
    throw error;
  }
  return p;
}

async function githubFetch(config, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data.message || `GitHub API 오류: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function encodeContent(content) {
  return Buffer.from(String(content ?? ""), "utf8").toString("base64");
}

function decodeContent(content) {
  return Buffer.from(String(content || ""), "base64").toString("utf8");
}

async function getFile(config, path) {
  const url = `https://api.github.com/repos/${config.owner}/${config.name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(config.branch)}`;
  return githubFetch(config, url);
}

function ghToken() {
  return clean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN);
}
function ghOwner() {
  const repo = clean(process.env.GITHUB_REPO || process.env.GITHUB_REPOSITORY || process.env.STELLA_GITHUB_REPO) || DEFAULT_REPO;
  return repo.split("/")[0] || "yesblue0342-bit";
}
async function ghGet(url, token) {
  const headers = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { headers });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) { const e = new Error(data.message || `GitHub API 오류: ${r.status}`); e.status = r.status; e.data = data; throw e; }
  return data;
}
// 레포 목록: 토큰 있으면 /user/repos(공개+비공개), 없으면 /users/{owner}/repos(공개만)
async function listRepos() {
  const token = ghToken(), owner = ghOwner();
  const url = token
    ? "https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&sort=updated"
    : `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`;
  const data = await ghGet(url, token);
  const repos = (Array.isArray(data) ? data : []).map((x) => ({
    name: x.name, full_name: x.full_name, owner: (x.owner && x.owner.login) || owner,
    default_branch: x.default_branch || "main", private: !!x.private,
    language: x.language || "", description: x.description || "", stargazers_count: x.stargazers_count || 0, updated_at: x.updated_at,
  }));
  return { authenticated: !!token, owner, count: repos.length, repos };
}
// 임의 레포 콘텐츠(디렉터리/파일) 읽기: 토큰 있으면 비공개 접근
async function readContents(owner, repo, path, ref) {
  const token = ghToken();
  const p = String(path || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  let url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}`;
  if (ref) url += `?ref=${encodeURIComponent(ref)}`;
  const data = await ghGet(url, token);
  if (Array.isArray(data)) return { type: "dir", items: data.map((x) => ({ name: x.name, path: x.path, type: x.type, sha: x.sha, size: x.size || 0 })) };
  return { type: "file", name: data.name, path: data.path, sha: data.sha, size: data.size || 0, encoding: data.encoding, content: data.content || "", download_url: data.download_url || null };
}

export default async function handler(req, res) {
  try {
    // 토큰 선택적 액션(공개는 토큰 없이, 비공개는 토큰 있을 때) — getConfig(토큰 필수)보다 먼저
    if (req.method === "GET" && clean(req.query?.action) === "repos") {
      return res.status(200).json({ ok: true, ...(await listRepos()) });
    }
    if (req.method === "GET" && clean(req.query?.action) === "contents") {
      const owner = clean(req.query?.owner), repo = clean(req.query?.repo);
      if (!owner || !repo) return res.status(400).json({ ok: false, message: "owner, repo required" });
      return res.status(200).json({ ok: true, ...(await readContents(owner, repo, clean(req.query?.path), clean(req.query?.ref))) });
    }

    const config = getConfig();

    if (req.method === "GET") {
      const path = assertSafePath(req.query?.path);
      const file = await getFile(config, path);
      return res.status(200).json({
        ok: true,
        repo: config.repo,
        branch: config.branch,
        path,
        sha: file.sha,
        content: file.type === "file" ? decodeContent(file.content) : null,
        type: file.type,
        items: Array.isArray(file) ? file.map((x) => ({ name: x.name, path: x.path, type: x.type, sha: x.sha })) : undefined
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = req.body || {};
      const path = assertSafePath(body.path);
      const content = body.content;
      const message = clean(body.message) || `Stella GPT update ${path}`;
      const branch = clean(body.branch) || config.branch;
      config.branch = branch;

      let sha = clean(body.sha);
      let exists = true;
      if (!sha) {
        try {
          const current = await getFile(config, path);
          sha = current.sha;
        } catch (error) {
          if (error.status === 404) exists = false;
          else throw error;
        }
      }

      const url = `https://api.github.com/repos/${config.owner}/${config.name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
      const payload = {
        message,
        content: encodeContent(content),
        branch
      };
      if (exists && sha) payload.sha = sha;

      const result = await githubFetch(config, url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      return res.status(200).json({
        ok: true,
        message: "GitHub Commit 완료. Vercel은 GitHub 연동 상태라면 자동 배포됩니다.",
        repo: config.repo,
        branch,
        path,
        commit_sha: result.commit?.sha || null,
        content_sha: result.content?.sha || null,
        html_url: result.content?.html_url || null
      });
    }

    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || "GitHub 처리 실패",
      detail: error.data || null
    });
  }
}
