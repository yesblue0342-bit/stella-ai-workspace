// POST /api/cc/save-drive — 세션 산출물(생성 파일)을 Google Drive(StellaGPT/0Program)에 저장.
// 공개 GitHub 노출 회피: 에이전트 생성물은 비공개 Drive로. 기존 Drive 인증 재사용(새 키/라우트 없음).
import { listEvents, normalizeEvents } from "./_maclient.mjs";
import { extractFilesFromEvents } from "../../lib/cc-files.mjs";
import { saveAgentFilesToDrive, saveTextToDrive } from "../../lib/drive-files.mjs";
import { getSessionRow, setSessionGithubUrl } from "../../lib/cc-db.mjs";
import { saveToGitHubBootstrap, loadFromGitHub, toRepoPath, hasGhToken, deriveAbapName, resolveProgramName, resolveExt } from "../../lib/github-store.mjs";

const GH_OWNER = "yesblue0342-bit", GH_REPO = "0Program";
// 저장 확장자: 첨부/명시 확장자(이미지 제외) → 코드펜스 언어 → ABAP 키워드 → txt.
function pgExt(body, text) { return resolveExt(body && body.ext, text); }
// 저장 파일명: programName이 비었거나 한글문장이면 소스에서 추출(resolveProgramName).
function pgName(body, text) { return resolveProgramName(String((body && body.programName) || "").trim(), text); }
// 거부/비프로그램 응답(예: "죄송하지만 …", 너무 짧음)은 0Program 저장에서 제외 — 쓰레기 파일 방지.
function isNonProgram(text) {
  const t = String(text || "").trim();
  if (t.length < 40) return true;
  return /^(죄송|미안|sorry|i\s*(can'?t|cannot|am\s+unable|'?m\s+sorry)|unable\s+to|as\s+an\s+ai)/i.test(t);
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  try {
    const { session, files: bodyFiles, source, text, header, app } = req.body || {};

    // STEP D: 수정 루프용 — 0Program에서 현재 소스 로드(같은 path) → 모델 컨텍스트로 제공.
    if (req.body && req.body.action === "load-github") {
      if (!hasGhToken()) return res.status(200).json({ ok: false, exists: false, reason: "no_token", message: "GitHub 저장소 미설정" });
      try {
        const ltext = String(req.body.text || "");
        const path = toRepoPath(pgName(req.body, ltext), pgExt(req.body, ltext));
        const cur = await loadFromGitHub({ owner: GH_OWNER, repo: GH_REPO, path });
        return res.status(200).json({ ok: true, exists: cur.exists, text: cur.text, path });
      } catch (e) {
        console.error("0Program 로드 실패:", e && e.message);
        return res.status(200).json({ ok: false, exists: false, message: "소스 로드 실패" });
      }
    }

    // C2: 텍스트 전문 저장 모드 — {앱명}_{YYYYMMDD_HHMMSS}.txt 한 개를 StellaGPT/0Program에 저장.
    //     세션 불필요(코덱스 챗 등 비세션 앱도 사용). text가 있으면 이 경로 우선.
    if (text != null && String(text).trim()) {
      const r = await saveTextToDrive({ app: app || "Stella", header, text });
      // STEP C/E: 0Program GitHub 이중 저장(비차단·실패 허용). Drive 저장/응답엔 영향 없음.
      // ★ 상태를 항상 반환(no_token/error reason) → "왜 저장 안 됨"을 프런트/사용자가 확인 가능. 토큰 문자열은 마스킹.
      const ghPath = toRepoPath(pgName(req.body, text), pgExt(req.body, text));
      let github;
      if (isNonProgram(text)) {
        github = { saved: false, reason: "non_program", message: "거부/비프로그램 응답으로 0Program 저장 생략", path: ghPath };
      } else if (!hasGhToken()) {
        github = { saved: false, reason: "no_token", message: "GitHub PAT(env) 미설정 — 0Program 저장 생략", path: ghPath };
      } else {
        try {
          await saveToGitHubBootstrap({ owner: GH_OWNER, repo: GH_REPO, path: ghPath, content: text,
            message: `auto: ${(pgName(req.body, text) || app || "program").slice(0, 60)} 저장 (${new Date().toISOString()})` });
          github = { saved: true, path: ghPath };
        } catch (e) {
          const tokRe = new RegExp("gh[pousr]_\\w+|github" + "_pat_\\w+", "g"); // PAT 마스킹(리터럴 분리로 시크릿 스캔 오탐 방지)
          const reason = String((e && e.message) || e || "").replace(tokRe, "***").slice(0, 160);
          console.error("0Program 저장 실패:", reason);
          github = { saved: false, reason: "error", message: reason, path: ghPath };
        }
      }
      return res.status(r.ok ? 200 : 500).json({
        ok: r.ok, storage: "google-drive", saved: r.ok ? 1 : 0, ...r, github,
        message: r.ok ? `Google Drive(${r.folder})에 ${r.name} 저장됨` : "Drive 저장 실패",
      });
    }

    if (!session) return res.status(400).json({ ok: false, error: "session required" });

    const row = await getSessionRow(session).catch(() => null);
    const title = (row && row.title) || session;

    // 파일 수집: 본문 우선, 없으면 세션 이벤트에서 추출(폴백)
    let files = Array.isArray(bodyFiles) && bodyFiles.length ? bodyFiles : null;
    if (!files) {
      const raw = await listEvents(session);
      files = extractFilesFromEvents(normalizeEvents(raw));
    }
    files = (files || []).filter((f) => f && f.path && f.content != null);
    if (!files.length) {
      return res.status(404).json({ ok: false, error: "no_files", message: "이 세션에서 저장할 생성 파일을 찾지 못했습니다 (빈 저장 방지)." });
    }

    const result = await saveAgentFilesToDrive({ files, title, source: source || "claude-code" });
    if (result.folderLink) { try { await setSessionGithubUrl(session, result.folderLink); } catch {} }

    return res.status(result.ok ? 200 : 500).json({
      ok: result.ok,
      storage: "google-drive",
      ...result,
      message: result.ok ? `Google Drive(${result.folder})에 ${result.saved}개 저장됨` : "Drive 저장 실패",
    });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: "save_drive_failed", message: String((e && e.message) || e) });
  }
}
