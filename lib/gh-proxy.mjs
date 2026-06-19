// lib/gh-proxy.mjs — GitHub 우회 프록시 공통 로직 (allowlist / CORS / public·private 판별 / 토큰)
// 브라우저는 GitHub를 직접 호출하지 않고 이 프록시를 거친다(차단망 우회). 토큰은 env에서만.

function clean(v) { return String(v == null ? "" : v).trim(); }

// ALLOWED_REPOS: 이 목록의 repo만 서빙(오픈 프록시 방지). env override 가능.
export function allowedRepos() {
  const env = clean(process.env.ALLOWED_REPOS);
  const list = (env ? env.split(",") : [
    "yesblue0342-bit/stella-ai-workspace",
    "yesblue0342-bit/Leehu",
  ]).map(s => clean(s).toLowerCase()).filter(Boolean);
  return new Set(list);
}
export function isAllowedRepo(repo) {
  return allowedRepos().has(clean(repo).toLowerCase());
}
// "owner/name" 파싱·검증
export function parseRepo(repo) {
  const r = clean(repo);
  const m = r.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) { const e = new Error("repo 형식 오류 (owner/name)"); e.status = 400; throw e; }
  return { owner: m[1], name: m[2], full: r };
}

// ALLOWED_ORIGINS: CORS 허용 출처. 요청 Origin이 이 목록이면 그 값을 echo(* 금지).
export function allowedOrigins() {
  const env = clean(process.env.ALLOWED_ORIGINS);
  const base = clean(process.env.VERCEL_BASE);
  const def = [
    "https://이후.com", "https://www.이후.com",
    "https://xn--hu5b23z.com", "https://www.xn--hu5b23z.com",
  ];
  const list = (env ? env.split(",") : def).map(clean).filter(Boolean);
  if (base) list.push(base.replace(/\/+$/, ""));
  return list;
}
// CORS 헤더 적용. 허용 출처면 echo, 아니면 미설정(동일 출처 요청은 Origin 없음 → 통과).
export function applyCors(req, res) {
  const origin = clean(req.headers && req.headers.origin);
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "x-proxy-secret, content-type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

export function ghToken() {
  return clean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN);
}
export function proxySecret() { return clean(process.env.PROXY_SECRET); }

// repo 공개/비공개 판별 — 콜드스타트당 1회 조회 후 메모리 캐시
const _metaCache = new Map();
export async function getRepoMeta(owner, name, signal) {
  const key = (owner + "/" + name).toLowerCase();
  if (_metaCache.has(key)) return _metaCache.get(key);
  const token = ghToken();
  const headers = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "stella-proxy" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { headers, signal });
  if (!r.ok) {
    // 404(미존재/비공개+토큰없음) 등은 캐시하지 않고 에러
    const e = new Error(`repo 메타 조회 실패 ${r.status}`); e.status = r.status === 404 ? 404 : 502; throw e;
  }
  const j = await r.json();
  const meta = { private: !!j.private, default_branch: j.default_branch || "main" };
  _metaCache.set(key, meta);
  return meta;
}

// path traversal / 민감파일 차단
export function assertSafePath(path) {
  const p = clean(path).replace(/^\/+/, "");
  if (p.includes("..") || p.startsWith(".git/") || p === ".env" || p.endsWith(".env") || p.includes("/.env")) {
    const e = new Error("보안상 접근할 수 없는 경로입니다."); e.status = 400; throw e;
  }
  return p;
}

// 비공개 repo 접근 게이트: PROXY_SECRET 일치 요구. 공개는 게이트 없음.
export function checkPrivateGate(req, isPrivate) {
  if (!isPrivate) return; // public: 게이트 불필요
  const secret = proxySecret();
  if (!secret) { const e = new Error("비공개 repo 프록시가 비활성화됨(PROXY_SECRET 미설정)"); e.status = 503; throw e; }
  const got = clean((req.headers && req.headers["x-proxy-secret"]) || (req.query && req.query.secret));
  if (got !== secret) { const e = new Error("접근 토큰이 필요합니다(비공개 repo)."); e.status = 401; throw e; }
}

export function jsonErr(res, status, message) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json({ ok: false, message });
}

// AbortController 타임아웃
export function withTimeout(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || 30000);
  return { signal: ac.signal, done: () => clearTimeout(t) };
}

export { clean };
