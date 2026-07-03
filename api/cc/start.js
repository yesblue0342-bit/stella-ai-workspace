// POST /api/cc/start — 에이전트/환경 재사용 + 세션 생성 + 첫 턴 전송
import { isValidModel, DEFAULT_MODEL, buildRepoPreamble } from "../../lib/agentcore.mjs";
import * as MA from "./_maclient.mjs";
import { getMeta, setMeta, saveSession } from "../../lib/cc-db.mjs";

const REPO_MOUNT_PATH = "/workspace/repo";
function ghToken() {
  return String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.STELLA_GITHUB_TOKEN || "").trim();
}
// "owner/name" 또는 {owner,name} → {owner,name} (형식 검증). 실패 시 null.
function parseRepo(repo) {
  if (repo && typeof repo === "object") {
    const owner = String(repo.owner || "").trim(), name = String(repo.name || repo.repo || "").trim();
    return owner && name ? { owner, name } : null;
  }
  const m = String(repo || "").trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { model: reqModel, prompt, title, budgetUsd, omc, vff, attachments, repo, branch } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "prompt required" });
    const model = isValidModel(reqModel) ? reqModel : DEFAULT_MODEL; // 화이트리스트 검증
    const budget = Math.max(0.01, Math.min(Number(budgetUsd) || 20, 50)); // 기본 $20, 상한 $50
    const useOmc = !!omc;
    const useVff = vff === true;

    // ── 레포 인식: 세션에 github_repository 리소스 마운트(토큰은 서버 env, 응답/로그 미노출) ──
    const parsed = parseRepo(repo);
    const token = ghToken();
    const wantRepo = !!(parsed && token);
    const repoBranch = String(branch || "main").trim() || "main";
    const resources = wantRepo ? [{
      type: "github_repository",
      url: "https://github.com/" + parsed.owner + "/" + parsed.name,
      mount_path: REPO_MOUNT_PATH,
      authorization_token: token,
    }] : undefined;

    const environmentId = await MA.getOrCreateEnvironment(getMeta, setMeta);
    const agentId = await MA.getOrCreateAgent(model, useOmc, useVff, getMeta, setMeta);
    const rawTitle = (title && String(title).trim()) || String(prompt).trim();
    const title2 = rawTitle.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Stella Agent Code";
    const { id: sessionId, repoMounted, mountError } = await MA.createSession(agentId, environmentId, title2, resources);

    // 레포가 실제 마운트된 경우에만 프리앰블을 붙인다(마운트 실패 시 잘못된 안내 방지).
    const preamble = repoMounted
      ? buildRepoPreamble({ owner: parsed.owner, repo: parsed.name, branch: repoBranch, mountPath: REPO_MOUNT_PATH })
      : "";
    await MA.sendUserMessage(sessionId, preamble + String(prompt), attachments);

    // 레포를 원했는데 못 붙은 경우, 이유를 명확히 반환(토큰 미설정/권한/미존재/미지원). 조용한 저하 방지.
    const repoMountError = repoMounted ? null
      : (parsed && !token) ? "서버 GITHUB_TOKEN 미설정(레포 마운트 불가)"
      : (parsed ? (mountError || "레포 마운트 실패") : null);

    await saveSession({ id: sessionId, title: title2, model, agentId, environmentId, status: "running", budgetUsd: budget, costUsd: 0 });
    return res.status(200).json({
      sessionId, agentId, environmentId, model, budgetUsd: budget, title: title2, omc: useOmc,
      repo: repoMounted ? (parsed.owner + "/" + parsed.name) : null, branch: repoMounted ? repoBranch : null,
      repoMounted: !!repoMounted, repoMountError,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "start_failed", message: String(e.message || e) });
  }
}
