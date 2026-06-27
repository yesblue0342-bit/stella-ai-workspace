const DEFAULT_REPO = "yesblue0342-bit/stella-ai-workspace";

function clean(value) {
  return String(value || "").trim();
}

function getConfig() {
  const token = clean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN);
  const repo = clean(process.env.GITHUB_REPO || process.env.GITHUB_REPOSITORY || process.env.STELLA_GITHUB_REPO) || DEFAULT_REPO;
  const branch = clean(process.env.GITHUB_BRANCH || process.env.STELLA_GITHUB_BRANCH) || "main";
  if (!token) {
    const error = new Error("GitHub 토큰 환경변수가 없습니다. 서버 .env 에 GITHUB_TOKEN 또는 STELLA_GITHUB_TOKEN을 등록하세요.");
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
  let data;
  try {
    data = await ghGet(url, token);
  } catch (e) {
    // 빈 레포(커밋 0개)는 GitHub가 404/409 "This repository is empty." 를 반환.
    // 루트 조회라면 에러 대신 빈 디렉터리로 정규화해 프런트가 안내 문구를 띄우게 한다.
    if ((e.status === 404 || e.status === 409) && /empty/i.test(e.message || "") && !p) {
      return { type: "dir", items: [], empty: true, message: "이 레포지토리는 비어 있습니다 (아직 커밋된 파일이 없습니다)." };
    }
    throw e;
  }
  if (Array.isArray(data)) return { type: "dir", items: data.map((x) => ({ name: x.name, path: x.path, type: x.type, sha: x.sha, size: x.size || 0 })) };
  return { type: "file", name: data.name, path: data.path, sha: data.sha, size: data.size || 0, encoding: data.encoding, content: data.content || "", download_url: data.download_url || null };
}

// ── 임의 레포 쓰기(파일관리자) 헬퍼 — 토큰 필수, 토큰은 헤더에만 ──
function writeHeaders(token) {
  return { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Authorization": `Bearer ${token}`, "User-Agent": "stella-hub" };
}
function contentsUrl(owner, repo, path) {
  const p = String(path || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}`;
}
// 파일 1개의 sha + base64 content 조회 (없으면 404 throw)
async function ghFileMeta(owner, repo, path, ref, token) {
  let url = contentsUrl(owner, repo, path);
  if (ref) url += `?ref=${encodeURIComponent(ref)}`;
  const d = await ghGet(url, token);
  if (Array.isArray(d)) { const e = new Error("폴더는 이 작업을 지원하지 않습니다 (파일 단위만)"); e.status = 400; throw e; }
  return { sha: d.sha, content: d.content || "", encoding: d.encoding };
}
async function ghPutRaw(owner, repo, path, { contentB64, message, branch, sha }, token) {
  const r = await fetch(contentsUrl(owner, repo, path), {
    method: "PUT", headers: { ...writeHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(sha ? { message, content: contentB64, branch, sha } : { message, content: contentB64, branch }),
  });
  const t = await r.text(); let d; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t }; }
  if (!r.ok) { const e = new Error(d.message || `GitHub PUT ${r.status}`); e.status = r.status; throw e; }
  return d;
}
async function ghDeleteRaw(owner, repo, path, { sha, message, branch }, token) {
  const r = await fetch(contentsUrl(owner, repo, path), {
    method: "DELETE", headers: { ...writeHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  const t = await r.text(); let d; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t }; }
  if (!r.ok) { const e = new Error(d.message || `GitHub DELETE ${r.status}`); e.status = r.status; throw e; }
  return d;
}
// sha 미제공 시 조회해서 채움
async function resolveSha(owner, repo, path, branch, sha, token) {
  if (sha) return sha;
  const m = await ghFileMeta(owner, repo, path, branch, token);
  return m.sha;
}
// 단일 쓰기 작업 디스패치 — 임의 owner/repo/branch 대상
async function doWriteAction(action, body, token) {
  const owner = clean(body.owner), repo = clean(body.repo);
  const branch = clean(body.branch) || "main";
  if (!owner || !repo) { const e = new Error("owner, repo required"); e.status = 400; throw e; }

  if (action === "upload") {
    const path = assertSafePath(body.path);
    // content는 base64(바이너리-safe). raw=true면 평문으로 보고 인코딩.
    const contentB64 = body.raw ? encodeContent(body.content) : String(body.content || "");
    let sha = null;
    try { sha = (await ghFileMeta(owner, repo, path, branch, token)).sha; } catch (e) { if (e.status !== 404) throw e; }
    const r = await ghPutRaw(owner, repo, path, { contentB64, message: clean(body.message) || `Upload ${path}`, branch, sha }, token);
    return { path, html_url: r.content?.html_url || null, commit_sha: r.commit?.sha || null };
  }
  if (action === "mkdir") {
    const dir = assertSafePath(body.path);
    const path = dir.replace(/\/+$/, "") + "/.gitkeep";
    const r = await ghPutRaw(owner, repo, path, { contentB64: encodeContent(""), message: `Create folder ${dir}`, branch }, token);
    return { path, html_url: r.content?.html_url || null };
  }
  if (action === "delete") {
    const path = assertSafePath(body.path);
    const sha = await resolveSha(owner, repo, path, branch, clean(body.sha), token);
    await ghDeleteRaw(owner, repo, path, { sha, message: clean(body.message) || `Delete ${path}`, branch }, token);
    return { path, deleted: true };
  }
  if (action === "copy" || action === "move" || action === "rename") {
    const src = assertSafePath(body.path);
    const dest = assertSafePath(body.dest);
    if (src === dest) { const e = new Error("원본과 대상 경로가 같습니다"); e.status = 400; throw e; }
    const meta = await ghFileMeta(owner, repo, src, branch, token); // base64 content + sha
    const contentB64 = String(meta.content || "").replace(/\s/g, "");
    // 대상이 이미 있으면 sha 필요
    let destSha = null;
    try { destSha = (await ghFileMeta(owner, repo, dest, branch, token)).sha; } catch (e) { if (e.status !== 404) throw e; }
    const put = await ghPutRaw(owner, repo, dest, { contentB64, message: `${action} ${src} -> ${dest}`, branch, sha: destSha }, token);
    if (action === "copy") return { src, dest, html_url: put.content?.html_url || null };
    // move/rename: dest 생성 성공 후 src 삭제 (실패 시 롤백 불가하면 둘 다 남김 보고)
    try {
      await ghDeleteRaw(owner, repo, src, { sha: meta.sha, message: `${action} cleanup ${src}`, branch }, token);
    } catch (e) {
      return { src, dest, moved: false, warning: `대상은 생성됐지만 원본 삭제 실패(둘 다 존재): ${e.message}` };
    }
    return { src, dest, moved: true, html_url: put.content?.html_url || null };
  }
  if (action === "batch") {
    const op = clean(body.op); // delete|copy|move
    const items = Array.isArray(body.items) ? body.items : [];
    const done = [], errors = [];
    for (const it of items) {
      try {
        const sub = await doWriteAction(op, { owner, repo, branch, path: it.path, sha: it.sha, dest: it.dest }, token);
        done.push(sub);
      } catch (e) { errors.push({ path: it.path, error: String(e.message || e) }); }
    }
    return { batch: op, done: done.length, total: items.length, results: done, errors: errors.length ? errors : undefined };
  }
  const e = new Error("알 수 없는 쓰기 액션: " + action); e.status = 400; throw e;
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

    // 임의 레포 쓰기 액션(파일관리자) — 토큰 필수. 레거시 단일 레포 PUT보다 먼저 처리.
    const WRITE_ACTIONS = ["upload", "mkdir", "delete", "copy", "move", "rename", "batch"];
    const writeAction = clean(req.body?.action);
    if (req.method === "POST" && WRITE_ACTIONS.includes(writeAction)) {
      const token = ghToken();
      if (!token) return res.status(400).json({ ok: false, message: "GitHub 토큰이 없습니다. GITHUB_TOKEN 환경변수를 등록하세요." });
      const result = await doWriteAction(writeAction, req.body || {}, token);
      return res.status(200).json({ ok: true, action: writeAction, ...result });
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
        message: "GitHub Commit 완료. main 푸시 시 GitHub Actions가 OCI로 자동 배포합니다.",
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
