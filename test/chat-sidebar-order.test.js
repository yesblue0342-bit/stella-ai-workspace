// index.html 사이드바 채팅 목록 계약(jsdom 실함수 구동):
//  1) 최신 활동(updatedAt)이 위로 정렬된다 — renderChatTree 가 배열 순서가 아니라 시각으로 정렬.
//  2) 채팅 카테고리는 기본 '접힘'(exp 기본값이 'all'/'none' 을 포함하지 않음).
//
// 회귀 대상: 예전엔 rooms 배열 순서 그대로 렌더 → 오래된 방에 새 메시지가 와도 위로 안 올라옴.
// 그리고 'all'/'none' 이 기본 펼침이라 목록이 항상 펼쳐져 있었음.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function extractMainScript(html) {
  const idx = html.indexOf("if(window.pdfjsLib)");
  const start = html.lastIndexOf("<script>", idx) + "<script>".length;
  const end = html.indexOf("</script>", idx);
  return html.slice(start, end);
}

async function boot() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appScript = extractMainScript(html);

  // renderChatTree 는 실제 함수를 검증하므로 스텁하지 않는다. 나머지 렌더러/부작용만 무력화.
  // DOMContentLoaded 자동 초기화(initEvents/initAuth 가 최소 DOM 에 없는 요소를 바인딩하다 throw)를
  // 무력화 — 검증 대상(renderChatTree/exp)과 무관하고, 미처리 예외가 테스트를 오탐 실패시키는 것 방지.
  const driver = `
;(function(){
  renderAll=function(){}; renderProjectTree=function(){}; renderBoardTree=function(){};
  renderNoteList=function(){}; renderMessages=function(){}; renderHeader=function(){};
  renderChips=function(){}; renderManage=function(){}; closeSidebar=function(){};
  initEvents=function(){}; initAuth=function(){}; syncSidebarLayout=function(){}; warmupDb=function(){}; ensureModelOptions=function(){};

  window.__order = function(seed){
    user={id:'u1', name:'u', email:'u1'}; users=[user];
    activeProjectId='all';
    rooms = seed;
    renderChatTree();
    var html = document.getElementById('chatCategoryTree').innerHTML;
    var titles=[], re=/item-title">([^<]*)</g, m;
    while((m=re.exec(html))) titles.push(m[1]);
    return titles;
  };

  window.__collapsed = function(){
    localStorage.removeItem(K.exp);
    var s = exp();
    // 렌더 결과에서 'open' 클래스 유무도 확인
    user={id:'u1'}; rooms=[{id:'r1',name:'a',updatedAt:'2026-01-01T00:00:00Z',messages:[]}]; activeProjectId='all';
    renderChatTree();
    var html = document.getElementById('chatCategoryTree').innerHTML;
    var firstSection = html.slice(0, html.indexOf('data-chatcat'));
    return { hasAll:s.has('all'), hasNone:s.has('none'), size:s.size, expKey:K.exp, openInDom:/tree-section open/.test(firstSection) };
  };
})();
`;

  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div id="app"></div><span id="userName"></span><span id="userEmail"></span>
       <div id="authModal"></div>
       <div id="projectCategoryTree"></div><div id="chatCategoryTree"></div><div id="boardTree"></div>
     </body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://stella.local/" }
  );
  const s = dom.window.document.createElement("script");
  s.textContent = appScript + "\n" + driver;
  dom.window.document.body.appendChild(s);
  return dom.window;
}

test("renderChatTree: 최신 활동(updatedAt)이 맨 위로 정렬된다", async () => {
  const win = await boot();
  // 배열은 일부러 뒤섞인 순서로 넣는다(오래됨 → 최신 → 중간).
  const titles = Array.from(win.__order([
    { id: "r-old", name: "old", projectId: "p1", updatedAt: "2026-01-01T00:00:00Z", messages: [] },
    { id: "r-new", name: "new", projectId: "p1", updatedAt: "2026-07-01T00:00:00Z", messages: [] },
    { id: "r-mid", name: "mid", projectId: "p1", updatedAt: "2026-04-01T00:00:00Z", messages: [] },
  ])); // 크로스-realm 배열 → Node 배열로 정규화(primitive 비교)
  // 'all' 섹션(첫 3개)이 최신순이어야: new > mid > old
  assert.equal(titles[0], "new", "가장 최근 updatedAt 이 맨 위");
  assert.equal(titles[1], "mid");
  assert.equal(titles[2], "old", "가장 오래된 것이 맨 아래");
});

test("renderChatTree: updatedAt 없으면 마지막 메시지 시각으로 정렬", async () => {
  const win = await boot();
  const titles = Array.from(win.__order([
    { id: "a", name: "A", projectId: "p1", createdAt: "2026-01-01T00:00:00Z", messages: [{ role: "user", text: "x", createdAt: "2026-02-01T00:00:00Z" }] },
    { id: "b", name: "B", projectId: "p1", createdAt: "2026-01-01T00:00:00Z", messages: [{ role: "user", text: "y", createdAt: "2026-09-01T00:00:00Z" }] },
  ]));
  assert.equal(titles[0], "B", "마지막 메시지가 더 최근인 B 가 위");
  assert.equal(titles[1], "A");
});

test("채팅 카테고리는 기본 접힘(exp 기본값에 all/none 없음)", async () => {
  const win = await boot();
  const c = win.__collapsed();
  assert.equal(c.hasAll, false, "'전체 채팅' 기본 펼침 아님");
  assert.equal(c.hasNone, false, "'미분류' 기본 펼침 아님");
  assert.equal(c.size, 0, "기본 펼침 세트 비어있음");
  assert.equal(c.openInDom, false, "DOM 섹션에 open 클래스 없음(접힘)");
  assert.match(c.expKey, /v83/, "exp 키 버전 bump 로 기존 사용자도 접힘 적용");
});
