// lib/chat/intent.mjs — 의도 감지 순수 함수 테스트.
// api/chat.js(1156줄) 모듈 분리 시 신설. detectGitHubIntent 오탐(업무 질문 → "auth 폴더 정리 완료")
// 회귀를 막는 것이 핵심.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectGitHubIntent, detectDriveIntent, trimHistoryByChars, isTpmError,
  isWeatherQuery, needsRealtimeSearch, needsWeatherContext, needsSapDriveSearch,
} from "../lib/chat/intent.mjs";

test("detectGitHubIntent: 명시적 auth 폴더 정리 명령만 액션", () => {
  assert.deepEqual(detectGitHubIntent("auth 폴더 정리해줘"), { type: "auth_cleanup" });
  assert.deepEqual(detectGitHubIntent("auth-cleanup 클린업 실행"), { type: "auth_cleanup" });
  // 'author'/'OAuth'/'정리' 단독은 절대 걸리면 안 된다
  assert.equal(detectGitHubIntent("이 부분 스펙 정리해줘. SAP QM CBO프로그램"), null);
  assert.equal(detectGitHubIntent("OAuth 인증 흐름 설명해줘"), null);
});

test("detectGitHubIntent: 레포 코드 파일만 read/update 대상 (동사가 앞에 올 때)", () => {
  assert.deepEqual(detectGitHubIntent("보여줘 index.html"), { type: "read", path: "index.html" });
  assert.deepEqual(detectGitHubIntent("수정해줘 server.mjs"), { type: "update_intent", path: "server.mjs" });
  // 업무 파일(.abap/.xlsx)은 액션이 아니라 일반 질문 → AI가 답한다
  assert.equal(detectGitHubIntent("읽어줘 ZAQMR0110.abap"), null);
  assert.equal(detectGitHubIntent("확인해줘 inspection_report.xlsx"), null);
});

test("detectGitHubIntent: github 상태는 'github' 명시가 있을 때만", () => {
  assert.deepEqual(detectGitHubIntent("github 연결 상태 확인"), { type: "github_status" });
  assert.equal(detectGitHubIntent("연결 상태 확인해줘"), null);
});

test("detectDriveIntent: 한국어/영어 단어경계/링크/#명령만 인식", () => {
  assert.equal(detectDriveIntent("내 드라이브에서 찾아줘"), true);
  assert.equal(detectDriveIntent("check my drive please"), true);
  assert.equal(detectDriveIntent("https://drive.google.com/drive/folders/abc123defg"), true);
  assert.equal(detectDriveIntent("#QM008"), true);
  // 오탐 방지: 부분 문자열 / 마크다운 제목 / 전처리 지시문 / 셔뱅
  assert.equal(detectDriveIntent("the driver was driven"), false);
  assert.equal(detectDriveIntent("# 제목입니다"), false);
  assert.equal(detectDriveIntent("## 소제목"), false);
  assert.equal(detectDriveIntent("#include <stdio.h>"), false);
  assert.equal(detectDriveIntent("#!/bin/bash"), false);
});

test("detectDriveIntent: 80자 초과 #줄은 본문으로 간주", () => {
  assert.equal(detectDriveIntent("#" + "a".repeat(85)), false);
});

test("trimHistoryByChars / isTpmError 는 분리 후에도 동일 동작", () => {
  assert.deepEqual(trimHistoryByChars(null, 100), []);
  assert.equal(trimHistoryByChars([{ content: "x".repeat(500) }], 10).length, 1);
  assert.equal(isTpmError(new Error("Request too large")), true);
  assert.equal(isTpmError(new Error("boom")), false);
});

test("키워드 게이트: 불필요한 외부 호출을 막는 조건", () => {
  assert.equal(isWeatherQuery("송도 날씨 알려줘"), true);
  assert.equal(isWeatherQuery("weather in Seoul"), true);
  assert.equal(isWeatherQuery("리팩터링 해줘"), false);

  assert.equal(needsRealtimeSearch("오늘 뉴스 알려줘"), true);
  assert.equal(needsRealtimeSearch("자바스크립트 클로저 설명"), false);

  assert.equal(needsWeatherContext("내일 비 와?"), true);
  assert.equal(needsSapDriveSearch("QA32 검사로트 조회"), true);
  assert.equal(needsSapDriveSearch("점심 뭐 먹지"), false);
});
