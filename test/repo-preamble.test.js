// lib/agentcore.mjs buildRepoPreamble 단위 테스트 — 에이전트 레포 인식 프리앰블 (실행: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRepoPreamble } from "../lib/agentcore.mjs";

test("owner/repo 없으면 빈 문자열(무영향)", () => {
  assert.equal(buildRepoPreamble({}), "");
  assert.equal(buildRepoPreamble({ owner: "a" }), "");
  assert.equal(buildRepoPreamble({ repo: "b" }), "");
  assert.equal(buildRepoPreamble(), "");
});

test("owner/repo 있으면 마운트 경로·브랜치·커밋 안내 포함", () => {
  const p = buildRepoPreamble({ owner: "yesblue0342-bit", repo: "0Program", branch: "main", mountPath: "/workspace/repo" });
  assert.match(p, /yesblue0342-bit\/0Program/);
  assert.match(p, /\/workspace\/repo/);
  assert.match(p, /main/);
  assert.match(p, /git push/);
  assert.match(p, /---\n$/); // 사용자 프롬프트와 구분자로 끝난다
});

test("branch/mountPath 기본값(main, /workspace/repo)", () => {
  const p = buildRepoPreamble({ owner: "o", repo: "r" });
  assert.match(p, /브랜치: main/);
  assert.match(p, /\/workspace\/repo/);
});

test("토큰 등 비밀은 프리앰블에 포함되지 않는다", () => {
  const p = buildRepoPreamble({ owner: "o", repo: "r", branch: "dev" });
  assert.doesNotMatch(p, /ghp_|github_pat_|authorization_token|Bearer/i);
});
