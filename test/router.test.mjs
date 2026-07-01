import { test } from "node:test"; import assert from "node:assert/strict";
import { wantsTable, buildSystemPrompt, extractText } from "../lib/router.mjs";
test("표 요청만", () => { assert.equal(wantsTable("표로 정리해줘"), true); assert.equal(wantsTable("송도 맛집"), false); });
test("검색 우선 문구", () => { assert.match(buildSystemPrompt({}), /추측하지 말고 web_search/); });
test("표 기본 금지/요청 허용", () => { assert.match(buildSystemPrompt({table:false}), /표를 만들지 않습니다/); assert.match(buildSystemPrompt({table:true}), /마크다운 표로 정리/); });
test("메모리 보존", () => assert.match(buildSystemPrompt({extra:"KH 메모리"}), /KH 메모리/));
test("파싱/폴백", () => { assert.equal(extractText({output:[{type:"message",content:[{type:"output_text",text:"ok"}]}]}),"ok"); assert.equal(extractText({output:[]}),"응답을 생성하지 못했습니다."); });
// 다운로드/엑셀/스펙 요청도 표로 처리(엑셀 다운로드 버그 수정)
test("다운로드·엑셀·스펙 요청 → 표", () => {
  assert.equal(wantsTable("엑셀로 다운로드 받게 해줘"), true);
  assert.equal(wantsTable("이 부분 스펙 정리해줘. sap QM 모듈 CBO프로그램"), true);
  assert.equal(wantsTable("파워포인트로 만들어줘"), true);
  assert.equal(wantsTable("오늘 날씨 어때"), false);   // 일반 질문은 그대로 산문
  assert.equal(wantsTable("송도 맛집"), false);
});
// 다운로드/복사 능력 고지가 프롬프트에 항상 포함 → 모델이 거절 안 함
test("다운로드 능력 고지 포함", () => {
  assert.match(buildSystemPrompt({}), /다운로드 버튼/);
  assert.match(buildSystemPrompt({}), /직접 복사/);
});
