// 첨부 인코딩 레이스 방지 헬퍼 테스트. (window.makeAttachEncoder/readFileAsDataURL 추출 + FileReader 목)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "js", "attach-encode.js"), "utf8");

// FileReader 목: delay 후 onload 호출(비동기 인코딩 시뮬레이션).
global.FileReader = class {
  readAsDataURL(file) {
    const self = this;
    setTimeout(() => { self.result = "data:image/png;base64," + (file && file.tag || "X"); if (self.onload) self.onload(); }, (file && file.delay) || 5);
  }
};
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const { makeAttachEncoder } = win;

test("export 확인", () => { assert.equal(typeof win.makeAttachEncoder, "function"); assert.equal(typeof win.readFileAsDataURL, "function"); });

test("whenReady: 모든 인코딩 완료 후에만 resolve (레이스 방지)", async () => {
  const enc = makeAttachEncoder();
  const results = [];
  const p1 = enc.encode({ tag: "A", delay: 15 }).then((s) => results.push(s));
  const p2 = enc.encode({ tag: "B", delay: 5 }).then((s) => results.push(s));
  assert.equal(enc.pendingCount(), 2);          // 시작 직후 진행중 2
  let readyAtZero = false;
  const wr = enc.whenReady().then(() => { readyAtZero = enc.pendingCount() === 0; });
  await Promise.all([p1, p2, wr]);
  assert.equal(enc.pendingCount(), 0);
  assert.equal(readyAtZero, true);              // whenReady는 pending=0에서만 풀림
  assert.equal(results.length, 2);
  assert.ok(results.every((s) => s.startsWith("data:image/png;base64,")));
});

test("onChange 콜백: 진행 카운트 변화 통지", async () => {
  const seen = [];
  const enc = makeAttachEncoder((n) => seen.push(n));
  await enc.encode({ tag: "C", delay: 3 });
  assert.ok(seen.includes(1));                  // 증가 통지
  assert.equal(seen[seen.length - 1], 0);       // 완료 시 0 통지
});

test("pending 없을 때 whenReady 즉시 resolve", async () => {
  const enc = makeAttachEncoder();
  await enc.whenReady(); // 멈추지 않아야 함
  assert.equal(enc.pendingCount(), 0);
});
