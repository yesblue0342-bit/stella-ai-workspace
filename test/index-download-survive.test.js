// Regression test: index.html renderAnswer() 다운로드 툴바가 마크다운 렌더 후에도 살아남는가.
//
// 진짜 원인(고질 버그): renderAnswer()가 다운로드 버튼을 el 에 붙인 "뒤"에
// stellaRenderMarkdown(el,text)를 호출했는데, 그 함수는 el.innerHTML=... 로 el 내용을
// 통째로 교체한다(js/stella-md.js). 그래서 marked+DOMPurify가 로드된 정상 환경에서는
// 방금 붙인 다운로드 버튼이 매번 지워졌다. (CDN이 안 뜨는 폴백 renderMarkdownLite는
// appendChild 방식이라 우연히 살아남아, "가끔 되고 가끔 안 되는" 것처럼 보였다.)
//
// 이 테스트는 marked+DOMPurify가 있는 조건(= innerHTML 경로)을 재현해, 렌더 후에도
// .download-tools 툴바가 버블에 남아 있는지 검증한다. 수정 전이면 실패, 수정 후 통과.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// index.html에서 renderAnswer 함수 본문만 뽑아온다(그 뒤 override 종료 주석까지).
function extractRenderAnswer(html) {
  const start = html.indexOf("function renderAnswer(el,text){");
  const marker = "/* /stella-rich-answer-download-override */";
  const end = html.indexOf(marker, start);
  if (start < 0 || end < 0) throw new Error("renderAnswer 소스를 찾지 못함");
  return html.slice(start, end);
}

function boot() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const renderAnswerSrc = extractRenderAnswer(html);
  const stellaMd = fs.readFileSync(path.join(ROOT, "js/stella-md.js"), "utf8");

  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, {
    runScripts: "dangerously",
    url: "http://localhost/",
  });
  const { window } = dom;

  // Blob URL 최소 폴리필(jsdom 미지원).
  window.URL.createObjectURL = () => "blob:mock";
  window.URL.revokeObjectURL = () => {};

  // 실제 프로덕션 조건 재현: marked + DOMPurify 존재 → stellaRenderMarkdown이 innerHTML 경로 사용.
  window.marked = { parse: (s) => "<p>" + String(s).replace(/</g, "&lt;") + "</p>" };
  window.DOMPurify = { sanitize: (h) => h };

  // 실제 stella-md.js 로드(= 진짜 stellaRenderMarkdown, el.innerHTML= 사용).
  window.eval(stellaMd);

  // renderAnswer가 참조하는 최소 의존성 스텁(다운로드 파일 생성 자체는 이 테스트 범위 밖).
  window.eval(`
    function btn(t,fn){var b=document.createElement('button');b.className='download-btn';b.type='button';b.textContent=t;b.onclick=fn;return b}
    function blobUrl(c,m){return URL.createObjectURL(new Blob([c],{type:m}))}
    function makeDownloadLink(label,name,url){var a=document.createElement('a');a.className='download-btn';a.href=url;a.download=name;a.textContent=label;return a}
    function tableRowsFromText(t){return (/\\|/.test(String(t||''))&&/-{2,}/.test(String(t||'')))?[['a','b']]:[]}
    function xlsxUrlFromText(t){return {url:'blob:mock',ext:'xlsx'}}
    function downloadDocFromText(){}
    function downloadPptFromText(){}
    function downloadPdfFromText(){}
    function renderMarkdownLite(el,t){el.textContent=String(t||'')}
  `);
  window.eval(renderAnswerSrc);
  return window;
}

test("marked+DOMPurify 로드 환경에서도 렌더 후 .download-tools 툴바가 살아남는다", () => {
  const window = boot();
  const el = window.document.createElement("div");
  el.className = "bubble";
  window.renderAnswer(el, "이제 작성된 내용을 Word 파일로 다운로드할 수 있습니다.");
  const tools = el.querySelector(".download-tools");
  assert.ok(tools, "마크다운 렌더 후에도 download-tools 툴바가 버블에 남아 있어야 함");
  const labels = [...tools.querySelectorAll(".download-btn")].map((b) => b.textContent);
  assert.ok(labels.some((l) => /Word/.test(l)), "Word 다운로드 버튼이 있어야 함");
  assert.ok(labels.some((l) => /PDF/.test(l)), "PDF 다운로드 버튼이 있어야 함");
});

test("툴바는 마크다운 본문 '뒤'에 위치한다(답변 아래에 버튼)", () => {
  const window = boot();
  const el = window.document.createElement("div");
  window.renderAnswer(el, "본문 내용입니다.");
  const kids = [...el.childNodes];
  const toolsIdx = kids.findIndex((n) => n.nodeType === 1 && n.classList && n.classList.contains("download-tools"));
  assert.ok(toolsIdx > 0, "툴바가 본문 뒤(마지막)에 와야 함");
  assert.equal(toolsIdx, kids.length - 1, "툴바가 버블의 마지막 자식이어야 함");
});

test("표가 있는 답변엔 Excel 버튼이 추가된다", () => {
  const window = boot();
  const el = window.document.createElement("div");
  window.renderAnswer(el, "| 항목 | 값 |\n|---|---|\n| A | 1 |");
  const labels = [...el.querySelectorAll(".download-btn")].map((b) => b.textContent);
  assert.ok(labels.some((l) => /Excel/.test(l)), "표가 있으면 Excel 버튼이 있어야 함");
});

test("빈 답변엔 툴바를 만들지 않는다", () => {
  const window = boot();
  const el = window.document.createElement("div");
  window.renderAnswer(el, "   ");
  assert.equal(el.querySelector(".download-tools"), null);
});
