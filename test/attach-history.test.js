// 첨부 파일 후속 턴 기억상실 버그 회귀 테스트.
// 버그: 첨부 텍스트가 현재 턴 message 에만 주입되고 대화 저장/히스토리에는 빠져,
// 다음 턴("아니 첨부한 양식대로 해줘")에서 AI가 "양식을 알지 못해"라고 답함.
// 수정: 메시지에 att(파일명+텍스트) 저장 + buildChatHistory 가 히스토리에 주입
// (마지막=현재 메시지는 제외 — 현재 턴 첨부는 message 본문으로 전문 전달됨).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// index.html 에서 buildChatHistory(순수 함수) 소스 추출 후 평가
function loadBuildChatHistory() {
  const start = html.indexOf("function buildChatHistory(");
  assert.ok(start >= 0, "buildChatHistory 정의 존재");
  let i = html.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return new Function(html.slice(start, end) + "; return buildChatHistory;")();
}

test("이전 턴의 첨부 텍스트가 히스토리에 주입된다", () => {
  const f = loadBuildChatHistory();
  const msgs = [
    { role: "user", text: "QM022 대본 만들어줘", att: [{ name: "QM script.docx", text: "1. Purpose\n2. Test Steps\n3. Expected Result" }] },
    { role: "ai", text: "네, 작성했습니다." },
    { role: "user", text: "아니 첨부한 양식대로 만들어줘" },
  ];
  const h = f(msgs, 10);
  assert.equal(h.length, 3);
  assert.match(h[0].content, /\[첨부파일: QM script\.docx\]/, "첫 턴 첨부가 히스토리에 포함");
  assert.match(h[0].content, /Test Steps/, "첨부 실제 내용 포함");
  assert.equal(h[1].role, "assistant");
  assert.equal(h[2].content, "아니 첨부한 양식대로 만들어줘");
});

test("마지막(현재) 메시지의 첨부는 히스토리에 중복 주입하지 않는다", () => {
  const f = loadBuildChatHistory();
  const msgs = [
    { role: "user", text: "안녕" },
    { role: "user", text: "이 파일 분석해줘", att: [{ name: "a.xlsx", text: "PLANT\tUS11" }] },
  ];
  const h = f(msgs, 10);
  assert.ok(!h[1].content.includes("첨부파일"), "현재 턴 첨부는 message 본문으로 가므로 히스토리 중복 금지");
});

test("첨부 텍스트는 4000자로 캡", () => {
  const f = loadBuildChatHistory();
  const big = "x".repeat(9000);
  const msgs = [
    { role: "user", text: "파일", att: [{ name: "big.txt", text: big }] },
    { role: "ai", text: "ok" },
  ];
  const h = f(msgs, 10);
  assert.ok(h[0].content.length < 4200 + 100, "히스토리 첨부 4000자 캡");
});

test("첨부 주입 총량 예산 8,000자(최신 우선) — TPM 429 방지", () => {
  const f = loadBuildChatHistory();
  const big = (n) => "y".repeat(n);
  const msgs = [
    { role: "user", text: "옛날 첨부", att: [{ name: "old.docx", text: big(6000) }] },
    { role: "ai", text: "ok" },
    { role: "user", text: "최근 첨부", att: [{ name: "new.docx", text: big(6000) }] },
    { role: "ai", text: "ok" },
    { role: "user", text: "질문" },
  ];
  const h = f(msgs, 10);
  const injected = h.reduce((s, m, i) => s + Math.max(0, m.content.length - String(msgs[i].text).length), 0);
  assert.ok(injected <= 8000 + 200, "총 주입량 예산 내: " + injected);
  assert.ok(h[2].content.includes("new.docx"), "최신 첨부 우선 포함");
});

test("addMessage persist 가 att 를 저장하도록 변경됐는지(소스 검증)", () => {
  assert.match(html, /_msg\.att=meta\.attachments/, "메시지 저장 시 첨부 텍스트 보존");
  assert.match(html, /buildChatHistory\(activeRoom\(\)\?\.messages,10,msg\)/, "send()가 buildChatHistory(+query) 사용");
  assert.match(html, /stellaCondense\(f\.text,msg,12000\)/, "현재 턴 첨부도 발췌 캡 적용(무제한 금지)");
});

// ── stellaCondense: 질문 관련부분 발췌(토큰 절약, ChatGPT식 검색·발췌 경량판) ──
function loadCondense() {
  const start = html.indexOf("function stellaCondense(");
  assert.ok(start >= 0, "stellaCondense 정의 존재");
  let i = html.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return new Function(html.slice(start, end) + "; return stellaCondense;")();
}

test("stellaCondense: 짧은 파일은 그대로(무손실)", () => {
  const f = loadCondense();
  const t = "짧은 양식 내용";
  assert.equal(f(t, "양식대로 만들어줘", 8000), t);
});

test("stellaCondense: 큰 파일은 질문 키워드 구간만 발췌 + 캡", () => {
  const f = loadCondense();
  const filler = Array.from({ length: 500 }, (_, i) => "무관한 내용 라인 " + i).join("\n");
  const t = filler + "\nQM022 검사 특성 조회 절차\n입력: Plant US11\n" + filler;
  const out = f(t, "QM022 테스트 절차 알려줘", 2000);
  assert.ok(out.length <= 2100, "캡 준수: " + out.length);
  assert.ok(out.includes("QM022"), "키워드 구간 포함");
  assert.ok(out.includes("US11"), "주변(±2줄) 문맥 포함");
});

test("stellaCondense: 키워드 미매칭 시 앞부분 폴백", () => {
  const f = loadCondense();
  const t = "z".repeat(20000);
  const out = f(t, "완전무관질문", 3000);
  assert.ok(out.length <= 3100 && out.startsWith("zzz"));
});
