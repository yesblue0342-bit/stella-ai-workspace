// POST /api/cc/save-drive — 세션 산출물(생성 파일)을 Google Drive(StellaGPT/0download)에 저장.
// 공개 GitHub 노출 회피: 에이전트 생성물은 비공개 Drive로. 기존 Drive 인증 재사용(새 키/라우트 없음).
import { listEvents, normalizeEvents } from "./_maclient.mjs";
import { extractFilesFromEvents } from "../../lib/cc-files.mjs";
import { saveAgentFilesToDrive, saveTextToDrive } from "../../lib/drive-files.mjs";
import { getSessionRow, setSessionGithubUrl } from "../../lib/cc-db.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  try {
    const { session, files: bodyFiles, source, text, header, app } = req.body || {};

    // C2: 텍스트 전문 저장 모드 — {앱명}_{YYYYMMDD_HHMMSS}.txt 한 개를 StellaGPT/0download에 저장.
    //     세션 불필요(코덱스 챗 등 비세션 앱도 사용). text가 있으면 이 경로 우선.
    if (text != null && String(text).trim()) {
      const r = await saveTextToDrive({ app: app || "Stella", header, text });
      return res.status(r.ok ? 200 : 500).json({
        ok: r.ok, storage: "google-drive", saved: r.ok ? 1 : 0, ...r,
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
