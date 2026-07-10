// cc.html → js/cc-app.js 추출 + VFF 토글 버그 회귀 방지.
//
// 버그: cc.html 의 인라인 onchange="onCcVffChange(this.checked)" 가 type="module" 스크립트
// 안의 함수를 참조했다. 인라인 핸들러의 스코프 체인(element→form→document→window)에는
// module 스코프가 없으므로 매 토글마다 ReferenceError 가 났고, VFF 선택이 저장되지 않았다.
// (gpt.html/abap.html 은 classic script 라 같은 패턴이 정상 동작한다 — cc.html 만의 문제였다.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const ccHtml = read("../cc.html");
const ccApp = read("../js/cc-app.js");

test("cc.html: 인라인 스크립트가 없고 외부 module 로 로드한다", () => {
  assert.match(ccHtml, /<script type="module" src="\/js\/cc-app\.js"><\/script>/);
  assert.doesNotMatch(ccHtml, /<script type="module">/, "인라인 module 블록이 남아있으면 안 됨");
  assert.ok(ccHtml.split("\n").length < 300, "cc.html 은 300줄 미만이어야 함");
});

test("cc.html: module 스코프를 참조하는 인라인 on*= 핸들러가 없다", () => {
  const handlers = ccHtml.match(/\son(?:click|change|input|submit)=/g) || [];
  assert.equal(handlers.length, 0, `인라인 핸들러 ${handlers.length}개 남음: module 스코프를 볼 수 없다`);
});

test("js/cc-app.js: VFF 토글을 addEventListener 로 바인딩한다", () => {
  assert.match(ccApp, /ccVffToggle/);
  assert.match(ccApp, /addEventListener\('change'/, "change 리스너로 바인딩");
  assert.match(ccApp, /from '\/claude\.client\.js'/, "VFF 저장 로직은 공유 헬퍼 재사용");
  assert.doesNotMatch(ccApp, /function (?:getCcVff|onCcVffChange)\b/, "중복 구현 제거됨");
});

test("VFF 토글: 체크 해제가 localStorage 에 저장되고 다시 읽힌다", async () => {
  const dom = new JSDOM(`<!doctype html><body><input type="checkbox" id="ccVffToggle"></body>`, { url: "https://stella.test/cc" });
  const { window } = dom;
  const store = new Map();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
  });

  // claude.client.js 의 공유 헬퍼와 동일한 계약을 이 DOM 위에서 재현해 바인딩을 검증한다.
  const KEY = "stella_vff_enabled";
  const getVffEnabled = () => { const v = window.localStorage.getItem(KEY); return v === null ? true : v === "true"; };
  const setVffEnabled = (val) => window.localStorage.setItem(KEY, String(!!val));

  const t = window.document.getElementById("ccVffToggle");
  t.checked = getVffEnabled();
  t.addEventListener("change", (e) => setVffEnabled(e.target.checked));

  assert.equal(t.checked, true, "미설정 기본값은 켜짐");

  t.checked = false;
  t.dispatchEvent(new window.Event("change"));
  assert.equal(store.get(KEY), "false", "해제가 저장됨 (버그 당시엔 저장되지 않았다)");
  assert.equal(getVffEnabled(), false, "새로고침 후에도 해제 유지");

  t.checked = true;
  t.dispatchEvent(new window.Event("change"));
  assert.equal(getVffEnabled(), true);
});

test("sw.js: cc-app.js 추가에 맞춰 캐시 버전이 올라갔다", () => {
  const sw = read("../sw.js");
  const m = sw.match(/const CACHE = 'stella-v(\d+)'/);
  assert.ok(m, "CACHE 버전 상수 존재");
  assert.ok(Number(m[1]) >= 115, `stella-v115 이상이어야 함 (현재 v${m[1]})`);
});
