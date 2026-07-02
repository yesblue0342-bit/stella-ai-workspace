// stella-md.js 표 정상화(normalizeMdTables) 회귀 테스트 — 표가 코드블록에 감싸이거나
// 구분선 없이 와서 '깨진' 파이프 텍스트로 보이던 버그. jsdom 없으면 skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const srcPath = path.join(__dirname, "..", "js", "stella-md.js");

let JSDOM = null;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { /* jsdom 미설치 → skip */ }

function loadNormalizer() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  dom.window.eval(fs.readFileSync(srcPath, "utf8"));
  return dom.window.stellaNormalizeMdTables;
}

test("코드펜스에 감싸인 표 → 펜스 벗겨 진짜 표로", { skip: !JSDOM }, () => {
  const norm = loadNormalizer();
  // 신고된 케이스: 모델이 표를 ``` 안에 넣어 파이프 텍스트로 깨져 보임
  const input = "여기 번역된 내용을 표로 정리했습니다:\n```\n| Function ID | Function Name | Description |\n|---|---|---|\n| EXECUTE | Execute Report | Execute inquiry based on QM Condition |\n```\n이 내용을 복사해서 사용하세요.";
  const out = norm(input);
  assert.ok(!out.includes("```"), "펜스 제거됨");
  assert.ok(out.includes("| Function ID | Function Name | Description |"), "표 본문 유지");
  assert.ok(out.includes("|---|---|---|"), "구분선 유지");
});

test("```markdown 언어태그 펜스도 벗김", { skip: !JSDOM }, () => {
  const norm = loadNormalizer();
  const out = norm("```markdown\n| a | b |\n|---|---|\n| 1 | 2 |\n```");
  assert.ok(!out.includes("```"));
  assert.ok(out.includes("| 1 | 2 |"));
});

test("구분선 없는 파이프 표 → |---| 자동 삽입", { skip: !JSDOM }, () => {
  const norm = loadNormalizer();
  const out = norm("| 단계 | 설명 |\n| 터미널 열기 | Ctrl+~ |\n| wget 사용 | wget URL |");
  const lines = out.split("\n");
  assert.equal(lines[0], "| 단계 | 설명 |");
  assert.match(lines[1], /^\|(---\|)+$/, "헤더 다음에 구분선 삽입");
  assert.equal(lines[2], "| 터미널 열기 | Ctrl+~ |");
});

test("진짜 코드 펜스(JS/쉘)는 절대 건드리지 않음", { skip: !JSDOM }, () => {
  const norm = loadNormalizer();
  const js = "```js\nconst x = 1;\nconsole.log(x);\n```";
  assert.equal(norm(js), js, "JS 코드 유지");
  // 쉘 파이프( | grep )가 줄 앞에 와도 표로 오인해 구분선 삽입하면 안 됨
  const sh = "```sh\ncat a.txt \\\n| grep foo | wc -l\n| grep bar | sort\n```";
  assert.equal(norm(sh), sh, "쉘 파이프 코드 유지(구분선 미삽입)");
});

test("혼합: 산문 + 펜스표 + 진짜코드 동시 처리", { skip: !JSDOM }, () => {
  const norm = loadNormalizer();
  const input = "설명 문단.\n```\n| h1 | h2 |\n|---|---|\n| v1 | v2 |\n```\n중간 텍스트\n```python\nprint('hi')\n```";
  const out = norm(input);
  assert.ok(out.includes("| v1 | v2 |") && !out.includes("```\n| h1"), "표 펜스는 벗김");
  assert.ok(out.includes("```python\nprint('hi')\n```"), "python 코드는 유지");
});

test("이미 정상인 표는 그대로(멱등)", { skip: !JSDOM }, () => {
  const norm = loadNormalizer();
  const ok = "| a | b |\n|---|---|\n| 1 | 2 |";
  assert.equal(norm(ok), ok);
  assert.equal(norm(norm(ok)), norm(ok), "두 번 적용해도 동일");
});
