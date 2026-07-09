// "새 노트" 버튼 회귀 테스트.
// 원인: renderAll()이 이미 마크업에서 제거된 #postList/#postCategorySelect(구 게시판 UI)를
// 참조하는 renderPosts()를 계속 호출해 매 렌더마다 TypeError를 던졌다. showApp()에서
// renderAll() 뒤에 실행돼야 할 restoreAllData()(Drive 노트/채팅 복원)가 로그인마다
// 조용히 스킵됐다. renderAll()에서 죽은 호출을 제거해 복원 체인이 끊기지 않게 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const indexPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(indexPath, "utf8");

let JSDOM = null;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { /* jsdom 미설치 → skip */ }

test("index.html에 #postList/#postCategorySelect를 참조하는 죽은 코드가 없다", () => {
  assert.doesNotMatch(html, /renderPosts\(\)/, "renderPosts() 호출이 남아있으면 안 됨(대상 DOM 삭제됨)");
  assert.doesNotMatch(html, /'#postList'/, "#postList 참조가 남아있으면 안 됨");
});

test("renderAll()이 예외 없이 완주하고 '새 노트' 버튼이 편집기를 연다", { skip: !JSDOM }, async () => {
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, items: [] }), text: async () => "{}" });
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

  await new Promise((r) => setTimeout(r, 300));

  const doc = w.document;
  const userObj = { id: "test_uid", name: "Test", email: "test@x.com", passwordHash: "x", createdAt: new Date().toISOString() };
  w.localStorage.setItem("stella_users_final_v82", JSON.stringify([userObj]));
  w.localStorage.setItem("stella_session_final_v82", JSON.stringify({ id: userObj.id, user: userObj, savedAt: Date.now() }));

  assert.doesNotThrow(() => w.initAuth(), "initAuth()/showApp()/renderAll() 전체가 예외 없이 완주해야 함");

  await new Promise((r) => setTimeout(r, 300));

  const openBoardBtn = doc.getElementById("openBoardBtn");
  openBoardBtn.click();
  assert.ok(doc.getElementById("boardPanel").classList.contains("active"), "노트 패널이 열려야 함");

  const newNoteBtn = [...doc.querySelectorAll("button")].find((b) => b.getAttribute("onclick") === "openNoteNew()");
  assert.ok(newNoteBtn, "'+ 새 노트' 버튼이 존재해야 함");

  const editorView = doc.getElementById("noteEditorView");
  const listView = doc.getElementById("noteListView");
  assert.equal(editorView.style.display, "none");

  newNoteBtn.click();

  assert.equal(editorView.style.display, "flex", "새 노트 클릭 시 편집기가 보여야 함");
  assert.equal(listView.style.display, "none");
  assert.ok(doc.getElementById("noteTitleInput").value, "새 노트 제목(날짜)이 자동 입력돼야 함");
});
