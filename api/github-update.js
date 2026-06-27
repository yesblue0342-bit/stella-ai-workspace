function clean(value) {
  return String(value || "").trim();
}

function safePath(input) {
  const path = clean(input).replace(/^\/+/, "");
  if (!path) {
    const error = new Error("수정할 파일 경로가 필요합니다. 예: index.html");
    error.status = 400;
    throw error;
  }
  if (path.includes("..") || path.startsWith(".git/") || path === ".env" || path.endsWith(".env") || path.includes("/.env")) {
    const error = new Error("보안상 수정할 수 없는 파일 경로입니다.");
    error.status = 400;
    throw error;
  }
  return path;
}

function githubConfig() {
  const token = clean(process.env.GITHUB_TOKEN);
  const owner = clean(process.env.GITHUB_OWNER);
  const repo = clean(process.env.GITHUB_REPO);
  const branch = clean(process.env.GITHUB_BRANCH) || "main";

  if (!token) throw Object.assign(new Error("환경변수 GITHUB_TOKEN이 없습니다."), { status: 500 });
  if (!owner) throw Object.assign(new Error("환경변수 GITHUB_OWNER가 없습니다."), { status: 500 });
  if (!repo) throw Object.assign(new Error("환경변수 GITHUB_REPO가 없습니다."), { status: 500 });

  return { token, owner, repo, branch };
}

function encodeBase64(content) {
  return Buffer.from(String(content ?? ""), "utf8").toString("base64");
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Stella-GPT",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!response.ok) {
    const message = data.message || `GitHub API 오류: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function readCurrentFile({ token, owner, repo, branch, path }) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  return githubRequest(url, token);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, message: "Method Not Allowed" });
    }

    const body = req.body || {};
    const path = safePath(body.path);
    if (body.content === undefined || body.content === null) {
      return res.status(400).json({ ok: false, message: "수정할 content가 필요합니다." });
    }

    const config = githubConfig();
    const branch = clean(body.branch) || config.branch;
    const message = clean(body.message) || "Update file from Stella GPT";
    const current = await readCurrentFile({ ...config, branch, path });

    if (Array.isArray(current) || current.type !== "file") {
      return res.status(400).json({ ok: false, message: "파일 경로만 수정할 수 있습니다.", path });
    }

    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const updateUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodedPath}`;
    const result = await githubRequest(updateUrl, config.token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: encodeBase64(body.content),
        sha: current.sha,
        branch
      })
    });

    return res.status(200).json({
      ok: true,
      message: "GitHub 저장/커밋 완료",
      path,
      branch,
      previous_sha: current.sha,
      content_sha: result.content?.sha || null,
      commit_sha: result.commit?.sha || null,
      commit_url: result.commit?.html_url || null
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || "GitHub 파일 수정 실패"
    });
  }
}
