// lib/drive-utils.js extractSearchKeywords 단위 테스트 — 링크 ID 오타 시 실제 폴더를 찾기 위한 키워드 추출.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSearchKeywords } from "../lib/drive-utils.js";

test("식별자형 토큰(QM008, ZAQMR0110)을 최우선으로 추출", () => {
  const kws = extractSearchKeywords("SAP QM모듈 CBO 프로그램 스펙 QM008 ZAQMR0110 작성해줘");
  assert.ok(kws.includes("QM008"));
  assert.ok(kws.includes("ZAQMR0110"));
  // 식별자형이 앞쪽에 온다
  assert.ok(kws.indexOf("QM008") <= 1);
});

test("URL·드라이브 명령어·흔한 동사는 키워드에서 제거", () => {
  const kws = extractSearchKeywords("https://drive.google.com/drive/folders/1abc 구글 드라이브 이 폴더 안의 파일을 리뷰하여 QM008 작성해줘");
  assert.ok(!kws.some(k => /https?:|drive|google|folders|1abc/i.test(k)), "URL 조각이 남으면 안 됨: " + kws.join(","));
  assert.ok(!kws.includes("폴더") && !kws.includes("리뷰") && !kws.includes("작성"), "명령어/동사가 남으면 안 됨: " + kws.join(","));
  assert.ok(kws.includes("QM008"));
});

test("빈/무의미 입력은 빈 배열", () => {
  assert.deepEqual(extractSearchKeywords(""), []);
  assert.deepEqual(extractSearchKeywords("이 폴더 파일 읽어줘"), []); // 전부 명령어/짧은 토큰
});

test("중복 제거 + 최대 6개 제한", () => {
  const kws = extractSearchKeywords("QM008 QM008 alpha1 beta2 gamma3 delta4 epsilon5 zeta6 eta7");
  assert.equal(new Set(kws).size, kws.length, "중복이 있으면 안 됨");
  assert.ok(kws.length <= 6);
});
