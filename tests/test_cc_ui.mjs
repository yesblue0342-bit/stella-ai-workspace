// tests/test_cc_ui.mjs — cc.html 레이아웃 핸들러(initLayout) 실제 동작 검증 (jsdom)
import { JSDOM } from "jsdom";
import fs from "fs";

const html = fs.readFileSync(new URL("../cc.html", import.meta.url), "utf8");
// cc.html에서 initLayout IIFE 원문 추출 → 실제 코드로 테스트
const m = html.match(/\/\/ ── 레이아웃[\s\S]*?\}\)\(\);/);
if (!m) { console.error("initLayout 블록을 찾지 못함"); process.exit(1); }
const iife = m[0];

let pass = 0, fail = 0;
const A = (n, ok, e) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}` + (ok || !e ? "" : `  (${e})`)); };

// 최소 DOM (cc.html의 신규 요소 구조 반영)
const dom = new JSDOM(`<!doctype html><html><body>
  <div class="top"><button id="hambBtn">☰</button><button id="fsBtn">⛶</button><button id="themeToggle"></button></div>
  <div class="wrap"><aside class="side"></aside><div class="resizer" id="resizer"></div><main class="main"></main></div>
  <div class="side-backdrop" id="sideBackdrop"></div><button id="fsExit"></button>
</body></html>`, { url: "https://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
const w = dom.window, doc = w.document, body = doc.body;

let MOBILE = false;
w.matchMedia = (q) => ({ matches: /max-width:\s*760px/.test(q) ? MOBILE : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
// initLayout 실행 ($ 정의 후 실제 코드 eval)
w.eval("var $=function(id){return document.getElementById(id)};" + iife);

function fire(el) { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }
const $ = (id) => doc.getElementById(id);

// ── 데스크톱: 햄버거 → side-collapsed 토글 ──
MOBILE = false;
fire($("hambBtn"));
A("데스크톱: 햄버거 → side-collapsed 추가", body.classList.contains("side-collapsed"));
fire($("hambBtn"));
A("데스크톱: 햄버거 재클릭 → 해제", !body.classList.contains("side-collapsed"));

// ── 모바일: 햄버거 → side-open, 코드영역 클릭 → 닫힘 ──
MOBILE = true;
fire($("hambBtn"));
A("모바일: 햄버거 → side-open", body.classList.contains("side-open"));
fire(doc.querySelector(".main"));
A("모바일: 코드영역 클릭 → side-open 해제", !body.classList.contains("side-open"));
// 백드롭 클릭 닫기
fire($("hambBtn"));
fire($("sideBackdrop"));
A("모바일: 백드롭 클릭 → 닫힘", !body.classList.contains("side-open"));

// ── 풀스크린 토글 ──
fire($("fsBtn"));
A("풀스크린 버튼 → fullscreen-code 추가", body.classList.contains("fullscreen-code"));
fire($("fsExit"));
A("풀스크린 종료 → 해제", !body.classList.contains("fullscreen-code"));

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
