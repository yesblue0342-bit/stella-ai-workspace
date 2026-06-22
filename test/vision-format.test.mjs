import { test } from "node:test"; import assert from "node:assert/strict";
import { openaiResponsesImage, openaiChatImage, claudeImage, visionImageBlock, supportsVision, ensureVisionModel, parseDataUrl } from "../lib/vision-format.mjs";
test("Responses 문자열", () => assert.deepEqual(openaiResponsesImage("AAA","image/png"),{type:"input_image",image_url:"data:image/png;base64,AAA"}));
test("Chat 객체", () => assert.deepEqual(openaiChatImage("AAA","image/jpeg"),{type:"image_url",image_url:{url:"data:image/jpeg;base64,AAA"}}));
test("Claude source", () => assert.deepEqual(claudeImage("AAA","image/webp"),{type:"image",source:{type:"base64",media_type:"image/webp",data:"AAA"}}));
test("api 분기", () => { assert.equal(visionImageBlock({api:"responses",base64:"AAA"}).type,"input_image"); assert.equal(visionImageBlock({api:"chat",base64:"AAA"}).type,"image_url"); assert.equal(visionImageBlock({api:"claude",base64:"AAA"}).type,"image"); });
test("supportsVision", () => { assert.equal(supportsVision("gpt-4o"),true); assert.equal(supportsVision("gpt-4.1-mini"),true); assert.equal(supportsVision("gpt-3.5-turbo"),false); });
test("ensureVisionModel", () => { assert.equal(ensureVisionModel("gpt-3.5-turbo",true),"gpt-4o"); assert.equal(ensureVisionModel("gpt-4o",true),"gpt-4o"); });
test("parseDataUrl", () => { assert.deepEqual(parseDataUrl("data:image/jpeg;base64,QUJD"),{base64:"QUJD",mediaType:"image/jpeg"}); assert.equal(ensureVisionModel("gpt-4.1-mini",true),"gpt-4.1-mini"); assert.equal(ensureVisionModel("text-davinci-003",true,"claude"),"claude-sonnet-4-6"); });
