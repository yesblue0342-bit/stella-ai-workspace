// Regression test for gpt.html's missing download-button feature.
//
// Root cause: api/chat.js's buildSystemPrompt() unconditionally tells the model
// "이 앱은 당신의 모든 답변에 Excel·Word·PDF·PPT·TXT·Markdown 다운로드 버튼을 자동으로
// 붙여줍니다" (this app auto-attaches download buttons to every answer), but gpt.html's
// render() never attached any such buttons — only a copy button. The model dutifully
// claimed the download was available while no button existed anywhere.
//
// This test boots the REAL inline script from gpt.html inside jsdom and asserts that
// (a) the markdown-table-aware export helpers work correctly, and (b) render() actually
// emits a download-tools toolbar (TXT/Word/PDF/PPT/Markdown, +Excel when a table is
// present) for every AI message.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function extractMainScript(html) {
  const start = html.indexOf("const K={session:");
  const end = html.indexOf("</script>", start);
  const script = html.slice(start, end);
  // 스크립트 끝부분의 top-level `boot();` 호출(로그인/모델버튼/테마 등 전체 앱 부트스트랩)은
  // 이 테스트 범위 밖(실 DOM 없이 실행하면 여러 요소에서 예외 발생) — 함수 선언은 호이스팅되므로
  // 호출부만 제거해도 render()/mdTableRows()/mdExportHtml() 등 대상 함수는 그대로 사용 가능.
  return script.replace("boot();", "");
}

async function boot() {
  const html = fs.readFileSync(path.join(ROOT, "gpt.html"), "utf8");
  const appScript = extractMainScript(html);

  const driver = `
;(function(){
  // renderSide()는 사이드바 전체 DOM(트리/검색 등)을 필요로 해 이 테스트 범위 밖 —
  // render()가 메시지 다운로드 툴바를 만드는지만 검증하므로 무력화.
  renderSide=function(){};
  window.__setChat=function(messages){
    chats=[{id:'c1',title:'t',messages:messages}];
    active='c1';
  };
})();
`;

  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="title"></div>
      <div id="msgs"></div>
    </body></html>`,
    { runScripts: "dangerously", url: "http://localhost/" }
  );
  // gpt.html의 스크립트는 함수 정의 사이사이에 $('버튼id').onclick=... 형태의
  // 최상위(top-level) UI 배선 코드도 포함한다. 이 테스트는 그 배선이 아니라
  // 다운로드 툴바 생성 로직만 검증하므로, 실제 DOM에 없는 요소는 no-op 스텁으로
  // 대체해 "Cannot set properties of null" 없이 스크립트가 끝까지 평가되게 한다.
  const realGetById = dom.window.document.getElementById.bind(dom.window.document);
  dom.window.document.getElementById = function (id) {
    const el = realGetById(id);
    if (el) return el;
    return {
      onclick: null, value: "", textContent: "", dataset: {}, style: {},
      classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
      addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){}, closest(){ return null; },
    };
  };
  // appScript는 top-level `let chats/active`를 쓴다 — appScript와 driver를 별도 eval()로
  // 실행하면 서로 다른 렉시컬 스코프가 생겨 driver의 chats 대입이 appScript 쪽 render()/cur()가
  // 보는 chats와 분리되어버린다(무언 실패). login-data-sync.test.js와 동일하게 하나의
  // <script> 요소로 합쳐 넣어 같은 스코프를 공유시킨다.
  const s = dom.window.document.createElement("script");
  s.textContent = appScript + "\n" + driver;
  dom.window.document.body.appendChild(s);
  return dom;
}

test("mdTableRows: 마크다운 표를 2차원 배열로 파싱", async () => {
  const dom = await boot();
  const { mdTableRows } = dom.window;
  const text = "결과\n\n| 항목 | 값 |\n|---|---|\n| A | 1 |\n| B | 2 |\n\n비고";
  const rows = JSON.parse(JSON.stringify(mdTableRows(text)));
  assert.deepEqual(rows, [["항목", "값"], ["A", "1"], ["B", "2"]]);
});

test("mdTableRows: 표 없으면 빈 배열", async () => {
  const dom = await boot();
  const { mdTableRows } = dom.window;
  assert.deepEqual(JSON.parse(JSON.stringify(mdTableRows("그냥 일반 문장입니다."))), []);
});

test("mdExportHtml: 표를 <table>로, 헤더를 <hN>으로, 코드펜스를 <pre>로 변환", async () => {
  const dom = await boot();
  const { mdExportHtml } = dom.window;
  const text = "# 제목\n\n| 항목 | 값 |\n|---|---|\n| A | 1 |\n\n```js\nconsole.log(1)\n```\n\n일반 문단입니다.";
  const html = mdExportHtml(text);
  assert.match(html, /<h1>제목<\/h1>/);
  assert.match(html, /<table><tr><th>항목<\/th><th>값<\/th><\/tr><tr><td>A<\/td><td>1<\/td><\/tr><\/table>/);
  assert.match(html, /<pre>console\.log\(1\)<\/pre>/);
  assert.match(html, /<p>일반 문단입니다\.<\/p>/);
});

test("mdExportHtml: HTML 특수문자를 이스케이프", async () => {
  const dom = await boot();
  const { mdExportHtml } = dom.window;
  assert.match(mdExportHtml("<script>alert(1)</script>"), /&lt;script&gt;/);
});

test("render(): AI 메시지에 다운로드 툴바(TXT/Word/PDF/PPT/Markdown)가 실제로 붙는다", async () => {
  const dom = await boot();
  const { window } = dom;
  window.__setChat([
    { role: "user", text: "안녕" },
    { role: "ai", text: "결과입니다." },
  ]);
  window.render();
  const html = window.document.getElementById("msgs").innerHTML;
  assert.match(html, /class="download-tools"/, "download-tools 툴바가 렌더링되어야 함");
  assert.match(html, /downloadTxtMsg\(1\)/);
  assert.match(html, /downloadWordMsg\(1\)/);
  assert.match(html, /downloadPdfMsg\(1,this\)/);
  assert.match(html, /downloadPptMsg\(1\)/);
  assert.match(html, /downloadMdMsg\(1\)/);
});

test("render(): 표가 있는 AI 답변에만 Excel 버튼이 추가로 붙는다", async () => {
  const dom = await boot();
  const { window } = dom;
  window.__setChat([
    { role: "ai", text: "표 없는 답변" },
    { role: "ai", text: "| 항목 | 값 |\n|---|---|\n| A | 1 |" },
  ]);
  window.render();
  const html = window.document.getElementById("msgs").innerHTML;
  assert.doesNotMatch(html, /downloadExcelMsg\(0\)/, "표 없는 메시지엔 Excel 버튼이 없어야 함");
  assert.match(html, /downloadExcelMsg\(1\)/, "표 있는 메시지엔 Excel 버튼이 있어야 함");
});

test("render(): user 메시지에는 다운로드 툴바가 붙지 않는다", async () => {
  const dom = await boot();
  const { window } = dom;
  window.__setChat([{ role: "user", text: "질문입니다" }]);
  window.render();
  const html = window.document.getElementById("msgs").innerHTML;
  assert.doesNotMatch(html, /class="download-tools"/);
});

// jsdom은 URL.createObjectURL을 기본 지원하지 않으므로 최소 폴리필로 대체 —
// downloadWordMsg(idx) 클릭 시 실제로 다운로드 앵커가 생성/클릭되는지(사용자가 보고한
// "버튼이 없다/눌러도 안 된다" 증상의 최종 단계)까지 끝까지 검증한다.
test("downloadWordMsg(idx): 클릭 시 .doc 다운로드 앵커가 생성되고 클릭된다", async () => {
  const dom = await boot();
  const { window } = dom;
  let created = 0;
  window.URL.createObjectURL = () => { created++; return "blob:mock-" + created; };
  window.URL.revokeObjectURL = () => {};
  window.__setChat([{ role: "ai", text: "결과: | 항목 | 값 |\n|---|---|\n| A | 1 |" }]);
  let clicked = null;
  const realCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = function (tag) {
    const el = realCreateElement(tag);
    if (tag === "a") {
      const realClick = el.click.bind(el);
      el.click = function () { clicked = { download: el.download, href: el.href }; return realClick(); };
    }
    return el;
  };
  window.downloadWordMsg(0);
  assert.equal(created, 1, "Blob URL이 생성되어야 함");
  assert.ok(clicked, "다운로드 앵커가 클릭되어야 함");
  assert.match(clicked.download, /^stella-.*\.doc$/, "파일명이 .doc로 끝나야 함");
  assert.match(clicked.href, /^blob:mock-/);
});
