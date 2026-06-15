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

export default async function handler(req, res) {
  try {
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
