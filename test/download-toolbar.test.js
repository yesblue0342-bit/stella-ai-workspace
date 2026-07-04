// index.html renderAnswer 다운로드 툴바 회귀 테스트.
// 버그: 표가 아닌 산문/목록 전체 답변("전체 내용에 대하여 MS Word 파일로 다운로드")은
// 특정 키워드로 물어야만 버튼이 뜨는 fragile 게이트에 걸려 다운로드가 안 됨.
// 수정: 표 유무·요청 문구와 무관하게 모든(비어있지 않은) 답변에 항상 툴바 제공 + PDF 신설.
// jsdom 없으면 skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let JSDOM = null;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { /* jsdom 미설치 → skip */ }

// index.html에서 다운로드 툴바 관련 함수 소스만 추출해 사실상 동일 코드를 검증한다.
function extractFns(html, names) {
  return names.map((name) => {
    let start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error("not found: " + name);
    const asyncPrefix = "async ";
    if (start >= asyncPrefix.length && html.slice(start - asyncPrefix.length, start) === asyncPrefix) start -= asyncPrefix.length;
    let i = html.indexOf("{", start), depth = 0, end = -1;
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    return html.slice(start, end);
  }).join("\n");
}

function setupDom() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const fnSrc = extractFns(html, [
    "btn", "mdEscapeHtml", "parseMarkdownTables", "splitTableRow", "tableRowsFromText",
    "blobUrl", "makeDownloadLink", "xlsxUrlFromText", "downloadBlobFile",
    "downloadDocFromText", "downloadPptFromText", "downloadPdfFromText", "renderAnswer",
  ]);
  const dom = new JSDOM("<!doctype html><body><div id=el></div></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.URL.createObjectURL = () => "blob:mock";
  window.stellaShowToast = () => {};
  window.stellaRenderMarkdown = null; // 폴백(renderMarkdownLite) 없어도 toolbar 로직만 검증
  window.renderMarkdownLite = () => {}; // 존재만 하면 충분(내부 렌더는 이 테스트 범위 밖)
  window.eval(fnSrc);
  return { window, el: window.document.getElementById("el") };
}

test("표 없는 산문/목록 답변도 다운로드 툴바가 항상 뜬다(키워드 불필요)", { skip: !JSDOM }, () => {
  const { window, el } = setupDom();
  const prose = "QM022 Unit Test 대본\n\n1. 프로그램 정보\n- 회사: Celltrion Branchburg\n- 개발 클래스: ZCQMD\n- 프로그램 ID: ZAQMR0060";
  window.renderAnswer(el, prose);
  const tools = el.querySelector(".download-tools");
  assert.ok(tools, "표가 없어도 download-tools 렌더됨");
  const labels = Array.from(tools.querySelectorAll("a,button")).map((n) => n.textContent);
  assert.ok(labels.some((l) => l.includes("TXT")), "TXT 버튼");
  assert.ok(labels.some((l) => l.includes("Word")), "Word 버튼");
  assert.ok(labels.some((l) => l.includes("PDF")), "PDF 버튼(신규)");
  assert.ok(labels.some((l) => l.includes("PPT")), "PPT 버튼");
  assert.ok(labels.some((l) => l.includes("Markdown")), "Markdown 버튼");
  assert.ok(!labels.some((l) => l.includes("Excel")), "표 없으면 Excel 버튼 없음(정상)");
});

test("표가 있으면 Excel 버튼도 추가로 뜬다", { skip: !JSDOM }, () => {
  const { window, el } = setupDom();
  const withTable = "결과:\n\n| 단계 | 설명 |\n|---|---|\n| 1 | 시작 |";
  window.renderAnswer(el, withTable);
  const tools = el.querySelector(".download-tools");
  const labels = Array.from(tools.querySelectorAll("a,button")).map((n) => n.textContent);
  assert.ok(labels.some((l) => l.includes("Excel")), "표 있으면 Excel 버튼 추가");
  assert.ok(labels.some((l) => l.includes("PDF")), "PDF 버튼도 여전히 있음");
});

test("빈 답변은 툴바를 만들지 않는다(공해 방지)", { skip: !JSDOM }, () => {
  const { window, el } = setupDom();
  window.renderAnswer(el, "   ");
  assert.equal(el.querySelector(".download-tools"), null);
});

test("PDF 버튼 클릭 → downloadPdfFromText 호출(라이브러리 로드 전이어도 안전)", { skip: !JSDOM }, () => {
  const { window, el } = setupDom();
  window.renderAnswer(el, "짧은 답변입니다.");
  const tools = el.querySelector(".download-tools");
  const pdfBtn = Array.from(tools.querySelectorAll("button")).find((b) => b.textContent.includes("PDF"));
  assert.ok(pdfBtn);
  // jspdf/html2canvas 미로드 상태(CDN 없는 테스트 환경) → throw 없이 토스트 경고만.
  assert.doesNotThrow(() => pdfBtn.onclick.call(pdfBtn));
});

test("index.html에 renderAnswer 선언이 정확히 1개(죽은 중복 정의 제거 확인)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const count = (html.match(/^function renderAnswer\(/gm) || []).length;
  assert.equal(count, 1);
});
