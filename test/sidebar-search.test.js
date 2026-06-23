// 사이드바 검색 이벤트 위임 검증(3경로). jsdom 없으면 skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const srcPath = path.join(__dirname, "..", "js", "sidebar-search.js");

let JSDOM = null;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { /* jsdom 미설치 → skip */ }

test("이벤트 위임: 버튼 클릭/입력/Enter 3경로 모두 검색 트리거", { skip: !JSDOM }, () => {
  const dom = new JSDOM("<!doctype html><html><body><input id=sideSearch><button id=sideSearchBtn>S</button></body></html>", { runScripts: "dangerously" });
  const w = dom.window;
  const calls = { search: 0, live: 0, liveVal: null };
  w.doSideSearch = () => { calls.search++; };
  w.doSideSearchLive = (v) => { calls.live++; calls.liveVal = v; };
  const s = w.document.createElement("script");
  s.textContent = fs.readFileSync(srcPath, "utf8");
  w.document.body.appendChild(s);
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));

  w.document.getElementById("sideSearchBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.equal(calls.search, 1, "버튼 클릭 → doSideSearch");

  const inp = w.document.getElementById("sideSearch");
  inp.value = "QM";
  inp.dispatchEvent(new w.InputEvent("input", { bubbles: true }));
  assert.equal(calls.live, 1, "입력 → doSideSearchLive");
  assert.equal(calls.liveVal, "QM");

  inp.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(calls.search, 2, "Enter → doSideSearch");
});

test("핸들러 미정의여도 throw 안 함(가드)", { skip: !JSDOM }, () => {
  const dom = new JSDOM("<!doctype html><html><body><input id=sideSearch><button id=sideSearchBtn>S</button></body></html>", { runScripts: "dangerously" });
  const w = dom.window;
  const s = w.document.createElement("script");
  s.textContent = fs.readFileSync(srcPath, "utf8");
  w.document.body.appendChild(s);
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  // doSideSearch 미정의 → console.warn만, throw 없어야
  assert.doesNotThrow(() => w.document.getElementById("sideSearchBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
});
