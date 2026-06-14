function clean(value) {
  return String(value || "").trim();
}

function safePath(input) {
  const path = clean(input).replace(/^\/+/, "");
  if (!path) {
    const error = new Error("읽을 파일 경로가 필요합니다. 예: index.html");
    error.status = 400;
    throw error;
  }
  if (path.includes("..") || path.startsWith(".git/") || path === ".env" || path.endsWith(".env") || path.includes("/.env")) {
    const error = new Error("보안상 읽을 수 없는 파일 경로입니다.");
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

  if (!token) throw Object.assign(new Error("Vercel 환경변수 GITHUB_TOKEN이 없습니다."), { status: 500 });
  if (!owner) throw Object.assign(new Error("Vercel 환경변수 GITHUB_OWNER가 없습니다."), { status: 500 });
  if (!repo) throw Object.assign(new Error("Vercel 환경변수 GITHUB_REPO가 없습니다."), { status: 500 });

  return { token, owner, repo, branch };
}

function decodeBase64(content) {
  return Buffer.from(String(content || "").replace(/\n/g, ""), "base64").toString("utf8");
}

async function githubRequest(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Stella-GPT"
    }
  });

  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!response.ok) {
    const message = data.message || `GitHub API 오류: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, message: "Method Not Allowed" });
    }

    const { token, owner, repo, branch } = githubConfig();
    const path = safePath(req.query?.path);
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    const data = await githubRequest(url, token);

    if (Array.isArray(data)) {
      return res.status(400).json({ ok: false, message: "폴더가 아니라 파일 경로를 입력하세요.", items: data.map(x => ({ name: x.name, path: x.path, type: x.type })) });
    }

    if (data.type !== "file") {
      return res.status(400).json({ ok: false, message: "파일만 읽을 수 있습니다.", path, type: data.type });
    }

    return res.status(200).json({
      ok: true,
      path: data.path || path,
      content: decodeBase64(data.content),
      sha: data.sha,
      branch,
      size: data.size
    });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.message || "GitHub 파일 읽기 실패" });
  }
}
