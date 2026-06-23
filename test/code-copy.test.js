// 코드 복사 단추 렌더 헬퍼 테스트. (window.toCodeHtml/esc 추출)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "js", "code-copy.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const { toCodeHtml, ccEsc: esc } = win;

test("export 확인", () => { assert.equal(typeof toCodeHtml, "function"); assert.equal(typeof win.attachCodeCopy, "function"); assert.equal(typeof win.renderCodeWithCopy, "function"); });

test("코드펜스 → pre.cc-pre + code, 언어줄 제거", () => {
  const h = toCodeHtml("설명\n```abap\nREPORT zaqmr0040.\n```");
  assert.match(h, /<pre class="cc-pre"><code>REPORT zaqmr0040\.<\/code><\/pre>/);
  assert.ok(h.indexOf("abap") < 0, "언어 토큰 줄은 제거되어야");
  assert.match(h, /<div style="white-space:pre-wrap">설명\s*<\/div>/);
});

test("HTML 이스케이프(주입 방지)", () => {
  const h = toCodeHtml("```\n<script>alert(1)</script> & x\n```");
  assert.ok(h.indexOf("<script>") < 0);
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; x/);
});

test("펜스 없는 일반 텍스트는 pre-wrap div", () => {
  const h = toCodeHtml("그냥 텍스트");
  assert.equal(h, '<div style="white-space:pre-wrap">그냥 텍스트</div>');
});

test("빈/널 → 빈 문자열", () => {
  assert.equal(toCodeHtml(""), "");
  assert.equal(toCodeHtml(null), "");
});

test("esc 기본", () => assert.equal(esc("<a>&</a>"), "&lt;a&gt;&amp;&lt;/a&gt;"));
