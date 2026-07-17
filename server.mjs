// Stella AI Workspace — OCI 우분투 서버 구동 Express 서버
//
// api/*.js(export default handler(req,res))를 자체 Node 서버에서 실행한다.
// 정적 파일 + 깔끔한 URL rewrites + CSP + /api 라우팅을 모두 여기서 처리한다.
// (Vercel 미사용 — 전부 OCI 우분투 서버로 이관. 함수 시간 제한 없어 5분 SSE 스트리밍 가능.)
//
// 실행: node server.mjs   (PORT 기본 8970)
// 환경변수(시크릿)는 .env 로 주입: docker run --env-file .env ...

import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const API_DIR = resolve(ROOT, "api");
const PORT = Number(process.env.PORT || 8970);

const app = express();
app.disable("x-powered-by");

// ── CSP (OCI 표준 보안 헤더) ─────────────────────────────────
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

// ── body 파싱 (JSON/폼/텍스트) — multipart 등은 통과 ──
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.text({ type: ["text/*"], limit: "25mb" }));

// ── 비공개 api 엔드포인트(개발/위험) — 외부 노출 금지(404). ──
// (이전 .vercelignore 의 api 항목을 코드로 내재화 — Vercel 의존 제거.)
const BLOCKED_API = new Set([
  "board-list", "board-save", "chat-list", "chat-save",
  "db-test", "drive-search", "drive-test", "init-db",
  "member-chat-list", "member-chat-save", "place-search",
  "weather-search", "pwa-manifest", "claude"
]);

// ── /api/* CORS (타 도메인 localStorage→OCI 이관용. 단순 허용) ──
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ── /api/* → api 파일의 default(req,res) 호출 ─────────────────
const handlerCache = new Map();
app.use("/api", async (req, res) => {
  const sub = req.path.replace(/^\/+/, "").split("?")[0]; // drive-list, cc/foo
  if (!sub) return res.status(404).json({ error: "no api path" });

  if (BLOCKED_API.has(sub)) return res.status(404).json({ error: `API not found: ${sub}` });

  const candidates = [`api/${sub}.js`, `api/${sub}/index.js`];
  for (const rel of candidates) {
    const abs = resolve(ROOT, rel);
    if (!abs.startsWith(API_DIR)) continue;     // 디렉토리 탈출 방지
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

// ── 깔끔한 URL rewrites → .html ──────────────────────────────
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

// ── 레거시 채팅(chatgpt/chats) → users/{uid}/chats 1회 이전 ──────────────
// 멱등·베스트에포트: 이미 이전된 파일은 스킵, 실패해도 서버 구동에 영향 없음(fire-and-forget).
// 비활성화: CHAT_MIGRATION=0
if (process.env.CHAT_MIGRATION !== "0") {
  (async () => {
    try {
      const { migrateChatsToUsers } = await import("./lib/chat/chat-drive.mjs");
      const r = await migrateChatsToUsers({ log: (m) => console.warn("[chat-migrate]", m) });
      if (r && (r.moved || r.deduped)) {
        console.log(`✅ [chat-migrate] moved=${r.moved} deduped=${r.deduped} users=${r.users}`);
      }
    } catch (e) {
      console.warn("[chat-migrate] 스킵:", e?.message || e);
    }
  })();
}
