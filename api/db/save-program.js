// POST /api/db/save-program — 프로그램 산출물을 Google Drive StellaGPT/0Program 에 저장.
// 본문: { app, title, ext, content } (+선택 fixedName=업서트, dryRun=폴더 확인만)
// 항상 JSON 반환. CLI(scripts/save-to-drive.mjs)·배포 스모크·앱 공용 진입점.
import { saveProgramToDrive, BASE_FOLDER } from "../../lib/drive-files.mjs";
import { ensurePath } from "../../lib/drive-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  try {
    const b = req.body || {};
    // dryRun: 인증·폴더 파이프라인만 검증(파일 생성 없음) — 배포 후 헬스체크용
    if (b.dryRun === true) {
      const f = await ensurePath([BASE_FOLDER]);
      return res.status(200).json({ ok: true, dryRun: true, folder: `StellaGPT/${BASE_FOLDER}`, folderId: f.id });
    }
    const content = String(b.content == null ? "" : b.content);
    if (!content.trim()) return res.status(400).json({ ok: false, error: "content required" });
    const r = await saveProgramToDrive({ app: b.app, title: b.title, ext: b.ext, content, fixedName: b.fixedName });
    return res.status(200).json(r);
  } catch (e) {
    // 시크릿/스택 미노출 — 메시지 앞부분만
    return res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
}
