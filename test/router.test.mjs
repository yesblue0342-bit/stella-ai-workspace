import { test } from "node:test"; import assert from "node:assert/strict";
import { wantsTable, buildSystemPrompt, extractText } from "../lib/router.mjs";
test("표 요청만", () => { assert.equal(wantsTable("표로 정리해줘"), true); assert.equal(wantsTable("송도 맛집"), false); });
test("검색 우선 문구", () => { assert.match(buildSystemPrompt({}), /추측하지 말고 web_search/); });
test("표 기본 금지/요청 허용", () => { assert.match(buildSystemPrompt({table:false}), /표를 만들지 않습니다/); assert.match(buildSystemPrompt({table:true}), /마크다운 표로 정리/); });
test("메모리 보존", () => assert.match(buildSystemPrompt({extra:"KH 메모리"}), /KH 메모리/));
test("파싱/폴백", () => { assert.equal(extractText({output:[{type:"message",content:[{type:"output_text",text:"ok"}]}]}),"ok"); assert.equal(extractText({output:[]}),"응답을 생성하지 못했습니다."); });
