/*
 * 알림 음성 파일 경로/자동업데이트 버전 계약 테스트.
 *  - api/talk-voice.js 의 음성 키와 talk.html TALK_VOICE_MP3 가 1:1 일치(빠진 벨소리 방지)
 *  - talk.html TALK_BUILD 와 sw.js CACHE 버전 동기(어긋나면 자동 새로고침 루프/미갱신)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { VOICE_PHRASES } from "../api/talk-voice.js";

const html = readFileSync("talk.html", "utf8");
const sw = readFileSync("sw.js", "utf8");

test("talk-voice: 서버 음성 키 ↔ 클라 TALK_VOICE_MP3 1:1 일치", () => {
  const keys = Object.keys(VOICE_PHRASES);
  assert.ok(keys.length >= 6, "음성 6종 이상");
  for (const k of keys) {
    assert.match(html, new RegExp("'" + k + "'\\s*:\\s*'/api/talk-voice\\?key=" + k + "'"), "TALK_VOICE_MP3 에 " + k + " 누락");
    assert.match(html, new RegExp("'" + k + "'\\s*:\\s*\\{emoji"), "TALK_VOICES 에 " + k + " 누락");
  }
});

test("talk-voice: 문구가 비어있지 않고 톤 지시 포함", () => {
  for (const [k, cfg] of Object.entries(VOICE_PHRASES)) {
    assert.ok(cfg.text && cfg.text.length >= 2, k + " text");
    assert.ok(cfg.inst && cfg.inst.length >= 5, k + " inst");
  }
});

test("자동업데이트: talk.html TALK_BUILD == sw.js CACHE 버전", () => {
  const b = html.match(/TALK_BUILD\s*=\s*'(v\d+)'/);
  const c = sw.match(/stella-(v\d+)/);
  assert.ok(b && c, "버전 상수 존재");
  assert.equal(b[1], c[1], "talk.html(" + b[1] + ") 와 sw.js(" + c[1] + ") 버전 불일치 — 함께 올릴 것");
});
