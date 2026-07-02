#!/usr/bin/env node
// scripts/save-to-drive.mjs — 산출물을 Google Drive StellaGPT/0Program 에 업로드.
// 사용: node scripts/save-to-drive.mjs <파일경로> [제목]
// CLAUDE.md 산출물 저장 규칙: GitHub 커밋과 함께 이 스크립트로 Drive 업로드까지 해야 DoD 충족.
// 1순위: 레포 Drive 모듈 직접 호출(.env 의 GOOGLE_* 필요) → 폴백: 로컬 서버 API POST.
import { readFileSync } from "fs";
import { basename, extname } from "path";

// .env 간이 로더(의존성 없음): 미설정 키만 채움. 값은 절대 출력하지 않는다.
try {
  const envTxt = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* .env 없으면 서버 API 폴백 사용 */ }

const [, , fileArg, titleArg] = process.argv;
if (!fileArg) {
  console.error("사용법: node scripts/save-to-drive.mjs <파일경로> [제목]");
  process.exit(2);
}
const content = readFileSync(fileArg, "utf8");
const ext = extname(fileArg).replace(/^\./, "") || "txt";
const title = titleArg || basename(fileArg, extname(fileArg));
const app = process.env.SAVE_APP || "cli";

try {
  const { saveProgramToDrive } = await import("../lib/drive-files.mjs");
  const r = await saveProgramToDrive({ app, title, ext, content });
  console.log(JSON.stringify({ ok: true, via: "drive-api", name: r.name, fileId: r.fileId, folder: r.folder }));
} catch (e1) {
  try {
    const base = (process.env.STELLA_BASE_URL || "http://127.0.0.1:8970").replace(/\/+$/, "");
    const res = await fetch(base + "/api/db/save-program", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app, title, ext, content }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || ("HTTP " + res.status));
    console.log(JSON.stringify({ ok: true, via: "server-api", name: d.name, fileId: d.fileId, folder: d.folder }));
  } catch (e2) {
    console.error(JSON.stringify({
      ok: false,
      direct: String((e1 && e1.message) || e1).slice(0, 120),
      server: String((e2 && e2.message) || e2).slice(0, 120),
    }));
    process.exit(1);
  }
}
