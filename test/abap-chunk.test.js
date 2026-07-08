// lib/abap-chunk.mjs 단위 테스트 — 대용량 ABAP 청킹/종합. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunkAbapSource, extractIssueLines, dedupeFindings, mergeAbapAnalyses, looksLikeAbap,
} from "../lib/abap-chunk.mjs";

// 여러 FORM으로 구성된 큰 소스 생성 헬퍼
function makeAbap(nForms, bodyLines) {
  const parts = ["REPORT zbig.", ""];
  for (let i = 1; i <= nForms; i++) {
    parts.push(`FORM form_${i}.`);
    for (let j = 0; j < bodyLines; j++) parts.push(`  WRITE: / 'form ${i} line ${j}'.`);
    parts.push(`ENDFORM.`);
    parts.push("");
  }
  return parts.join("\n");
}

test("chunkAbapSource: 라인 커버리지 보장 (join === 원본)", () => {
  const src = makeAbap(10, 20);
  const chunks = chunkAbapSource(src, { maxChars: 800 });
  assert.ok(chunks.length > 1, "여러 청크로 분할되어야: " + chunks.length);
  assert.equal(chunks.map((c) => c.text).join("\n"), src, "전체 라인 손실/중복 없음");
  // 라인 번호 연속성
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(chunks[i].startLine, chunks[i - 1].endLine + 1, "라인 경계 연속");
  }
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[chunks.length - 1].endLine, src.split("\n").length);
});

test("chunkAbapSource: 구조 경계(FORM)에서 분할한다", () => {
  const src = makeAbap(6, 10);
  const chunks = chunkAbapSource(src, { maxChars: 400 });
  // 첫 줄이 아닌 청크는 대체로 FORM으로 시작(경계 분할). 최소 하나는 FORM 시작이어야 한다.
  const formStarts = chunks.slice(1).filter((c) => /^\s*FORM\b/i.test(c.text.split("\n")[0]));
  assert.ok(formStarts.length >= 1, "구조 경계에서 분할된 청크 존재");
});

test("chunkAbapSource: 경계 없는 초대형 블록도 hardMax로 강제 분할", () => {
  // 경계 키워드 없는 한 덩어리
  const lines = [];
  for (let i = 0; i < 500; i++) lines.push(`  x = x + ${i}.`);
  const src = lines.join("\n");
  const chunks = chunkAbapSource(src, { maxChars: 500, hardMaxChars: 800 });
  assert.ok(chunks.length > 1, "경계 없어도 강제 분할");
  assert.equal(chunks.map((c) => c.text).join("\n"), src);
  for (const c of chunks) assert.ok(c.text.length <= 1200, "각 청크가 과도하게 크지 않음");
});

test("chunkAbapSource: 작은 소스는 단일 청크", () => {
  const src = "REPORT z.\nWRITE 'hi'.";
  const chunks = chunkAbapSource(src, { maxChars: 12000 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, src);
  assert.equal(chunks[0].total, 1);
});

test("chunkAbapSource: 빈 입력은 빈 배열", () => {
  assert.deepEqual(chunkAbapSource(""), []);
  assert.deepEqual(chunkAbapSource(null), []);
});

test("extractIssueLines: 불릿+키워드 줄만 추출", () => {
  const text = [
    "이 코드는 대체로 정상입니다.",
    "- SELECT * 사용으로 성능 문제가 있습니다.",
    "- 변수명이 명확합니다.",           // 이슈 키워드 없음 → 제외
    "* 잠재적 short dump 위험이 있습니다.",
    "1. deprecated FM 사용 (경고).",
    "그냥 문장 오류 없음",              // 불릿 아님 → 제외
  ].join("\n");
  const issues = extractIssueLines(text);
  assert.equal(issues.length, 3);
  assert.ok(issues.some((i) => /SELECT \*/.test(i)));
  assert.ok(issues.some((i) => /short dump/i.test(i)));
  assert.ok(issues.some((i) => /deprecated/i.test(i)));
});

test("dedupeFindings: 불릿/공백/대소문자 무시하고 중복 제거, 순서 보존", () => {
  const out = dedupeFindings([
    "- SELECT * 사용으로 성능 저하",
    "* select *  사용으로 성능 저하",   // 정규화하면 동일
    "- 무한 LOOP 위험",
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0], "- SELECT * 사용으로 성능 저하");
  assert.ok(out[1].includes("무한 LOOP"));
});

test("mergeAbapAnalyses: 단일 청크는 그대로, 다중은 종합+상세", () => {
  assert.equal(mergeAbapAnalyses([{ index: 0, total: 1, startLine: 1, endLine: 3, text: "정상입니다." }]), "정상입니다.");

  const merged = mergeAbapAnalyses([
    { index: 0, total: 2, startLine: 1, endLine: 10, text: "- SELECT * 성능 문제 있음" },
    { index: 1, total: 2, startLine: 11, endLine: 20, text: "- select * 성능 문제 있음\n- 무한 LOOP 위험" },
  ]);
  assert.match(merged, /2개 청크/);
  assert.match(merged, /종합 이슈/);
  // 중복(SELECT *)은 한 번만, 무한 LOOP는 별도로
  const bodyIssues = merged.split("청크별 상세")[0];
  assert.equal((bodyIssues.match(/성능 문제/g) || []).length, 1, "중복 이슈는 종합에서 1회");
  assert.match(merged, /무한 LOOP/);
  assert.match(merged, /청크 1\/2 \(라인 1–10\)/);
  assert.match(merged, /청크 2\/2 \(라인 11–20\)/);
});

test("mergeAbapAnalyses: 빈 결과는 빈 문자열", () => {
  assert.equal(mergeAbapAnalyses([]), "");
  assert.equal(mergeAbapAnalyses([{ text: "" }]), "");
});

test("looksLikeAbap: 코드성 텍스트(시그널 3종+)만 true, 일반 문서/짧은 텍스트는 false", () => {
  const abap = makeAbap(4, 8) + "\nPERFORM form_1.\nSELECT * FROM mara.\nLOOP AT it_tab.\nENDLOOP.";
  assert.equal(looksLikeAbap(abap), true);
  // 일반 문서(대용량이어도 ABAP 시그널 없음) → false (회귀 방지: 문서 Q&A는 청킹 안 함)
  const doc = "이 문서는 품질관리 절차서입니다. ".repeat(200);
  assert.equal(looksLikeAbap(doc), false);
  // 짧은 텍스트는 무조건 false
  assert.equal(looksLikeAbap("FORM x. ENDFORM."), false);
  assert.equal(looksLikeAbap(""), false);
});
