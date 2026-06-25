// Stella AI Workspace — OCI 구동용 Express 어댑터 서버
//
// Vercel 서버리스 함수(api/*.js, export default handler(req,res))를
// 자체 Node 서버에서 그대로 실행한다. 정적 파일 + rewrites + CSP + /api 라우팅 처리.
// Vercel Hobby의 함수 시간 제한(60초)이 없어 5분짜리 SSE 스트리밍도 가능.
//
// 실행: node server.mjs   (PORT 기본 8970)
// 환경변수(시크릿)는 .env 로 주입: docker run --env-file .env ...

import express from "express";
import cookieParser from "cookie-parser";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const API_DIR = resolve(ROOT, "api");
const PORT = Number(process.env.PORT || 8970);

const app = express();
app.disable("x-powered-by");

// ── CSP (vercel.json 과 동일) ────────────────────────────────
const CSP =
  "default-src 'self' https: data: blob:; " +
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https:; " +
  "style-src 'self' 'unsafe-inline' https:; " +
  "img-src 'self' data: blob: https:; " +
  "font-src 'self' data: https:; " +
  "connect-src 'self' https:; " +
  "media-src 'self' data: blob: https:; " +
  "worker-src 'self' blob:; frame-src 'self' https:";
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  next();
});

// ── body 파싱 (Vercel은 JSON 자동 파싱) — multipart 등은 통과 ──
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.text({ type: ["text/*"], limit: "25mb" }));

// ── .vercelignore 로드 (Vercel이 무시하는 함수는 여기서도 404) ──
const ignoreSet = new Set();
try {
  readFileSync(join(ROOT, ".vercelignore"), "utf8")
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .forEach((p) => ignoreSet.add(p.replace(/^\/+/, "")));
} catch { /* 없으면 무시 */ }

// ── /api/* → api 파일의 default(req,res) 호출 ─────────────────
const handlerCache = new Map();
app.use("/api", async (req, res) => {
  const sub = req.path.replace(/^\/+/, "").split("?")[0]; // drive-list, cc/foo
  if (!sub) return res.status(404).json({ error: "no api path" });

  const candidates = [`api/${sub}.js`, `api/${sub}/index.js`];
  for (const rel of candidates) {
    const abs = resolve(ROOT, rel);
    if (!abs.startsWith(API_DIR)) continue;     // 디렉토리 탈출 방지
    if (ignoreSet.has(rel)) continue;           // Vercel 무시 목록 존중
    if (!existsSync(abs)) continue;

    try {
      let handler = handlerCache.get(abs);
      if (!handler) {
        const mod = await import(pathToFileURL(abs).href);
        handler = mod.default;
        if (typeof handler !== "function") {
          return res.status(500).json({ error: `${rel}: default export 없음` });
        }
        handlerCache.set(abs, handler);
      }
      return await handler(req, res);
    } catch (err) {
      console.error(`[api/${sub}]`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: String(err?.message || err) });
      }
      return;
    }
  }
  res.status(404).json({ error: `API not found: ${sub}` });
});

// ── rewrites (vercel.json) — 깔끔한 URL → .html ──────────────
const REWRITES = {
  "/": "index.html",
  "/gpt": "gpt.html", "/chatgpt": "gpt.html", "/stella-gpt": "gpt.html",
  "/talk": "talk.html", "/stella-talk": "talk.html",
  "/cloud": "cloud.html", "/stella-cloud": "cloud.html",
  "/db": "db.html",
  "/hub": "hub.html", "/stella-hub": "hub.html",
  "/cc": "cc.html", "/code": "cc.html", "/stella-code": "cc.html",
  "/abap": "abap.html", "/stella-abap": "abap.html",
  "/codex": "codex.html", "/stella-codex": "codex.html",
  "/developer": "developer.html",
  "/restore": "restore.html",
};
app.get(/.*/, (req, res, next) => {
  const target = REWRITES[req.path];
  if (target && existsSync(join(ROOT, target))) {
    return res.sendFile(join(ROOT, target));
  }
  next();
});

// ── 정적 파일 (HTML/JS/CSS/icons/sounds/manifest 등) ─────────
app.use(express.static(ROOT, { extensions: ["html"], index: "index.html" }));

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).send("Not Found"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Stella AI Workspace (OCI) listening on :${PORT}`);
});
