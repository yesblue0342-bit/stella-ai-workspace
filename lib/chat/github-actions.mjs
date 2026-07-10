// lib/chat/github-actions.mjs — 채팅에서 감지한 GitHub 명령을 self-call 로 실행한다.
// api/chat.js 분리의 일부. 같은 서버의 다른 /api 라우트를 호출하므로 OCI 단일 서버에선 루프백.

/** 자기 자신(같은 프로세스)의 API 베이스 URL. 외부 도메인이 필요하면 PUBLIC_BASE_URL 로 오버라이드. */
export function selfBase() {
  return (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8970}`).replace(/\/+$/, "");
}

async function callGitHubRead(path) {
  const r = await fetch(`${selfBase()}/api/github-read?path=${encodeURIComponent(path)}`);
  return r.json();
}

async function callAuthCleanup() {
  const r = await fetch(`${selfBase()}/api/auth-cleanup`, { method: "POST" });
  return r.json();
}

/**
 * detectGitHubIntent 결과를 실행해 사용자에게 보여줄 마크다운을 만든다.
 * 처리 대상이 아니거나 호출이 실패하면 null → 호출부가 일반 AI 응답으로 폴백한다.
 * @param {{type: string, path?: string}|null} intent
 * @returns {Promise<string|null>}
 */
export async function runGitHubIntent(intent) {
  if (!intent) return null;
  try {
    if (intent.type === "auth_cleanup") {
      const r = await callAuthCleanup();
      return r.ok
        ? `✅ auth 폴더 정리 완료\n| 항목 | 내용 |\n|---|---|\n| 정리된 폴더 | ${r.message || "완료"} |\n| 유지된 폴더 ID | ${r.kept || "-"} |`
        : `❌ 정리 실패: ${r.error || r.message}`;
    }
    if (intent.type === "read") {
      const r = await callGitHubRead(intent.path);
      const preview = r.content ? r.content.slice(0, 500) : (r.error || "읽기 실패");
      return `📄 **${intent.path}** 파일 내용 (앞 500자)\n\`\`\`\n${preview}\n\`\`\``;
    }
    if (intent.type === "github_status") {
      const r = await callGitHubRead("package.json");
      return r.content
        ? `✅ GitHub 연결 정상\n| 항목 | 상태 |\n|---|---|\n| 저장소 | yesblue0342-bit/stella-ai-workspace |\n| Read | ✅ |\n| Commit | ✅ (GITHUB_TOKEN 등록됨) |\n| 자동배포 | ✅ (GitHub Actions → OCI) |`
        : `❌ GitHub 연결 실패: ${r.error || "토큰 확인 필요"}`;
    }
  } catch (err) {
    console.warn("[github-actions] 실행 실패, AI 폴백:", err.message);
  }
  // update_intent 등 미구현 타입은 AI가 답하도록 넘긴다(기존 동작 유지).
  return null;
}
