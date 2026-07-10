// lib/drive/detect.js — 경로/링크/키워드 감지 + 질의 발췌 순수 함수 테스트.
// 기존 drive-link.test.js / drive-keywords.test.js 는 배럴(lib/drive-utils.js) 경유 회귀를 지키고,
// 이 파일은 분리된 모듈을 직접 검증한다(발췌·cleanupPathPart 신규 커버리지).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupPathPart, condenseForQuery, detectDrivePathText, detectDriveLink, extractSearchKeywords,
} from "../lib/drive/detect.js";

test("cleanupPathPart: 명령성 꼬리말 제거, 폴더명은 보존", () => {
  assert.equal(cleanupPathPart("QM008 분석해줘"), "QM008");
  assert.equal(cleanupPathPart("SAP 스펙 파일을 정리해줘"), "SAP 스펙");
  assert.equal(cleanupPathPart("보고서 찾아줘"), "보고서");
  assert.equal(cleanupPathPart("분석자료"), "분석자료", "공백 경계가 없으면 자르지 않는다");
});

test("detectDrivePathText: #명령 규약", () => {
  assert.equal(detectDrivePathText("#QM008"), "QM008");
  assert.equal(detectDrivePathText("#구글드라이브폴더 3디와이/SAP 분석해줘"), "3디와이 > SAP");
  assert.equal(detectDrivePathText("#상위 > 하위"), "상위 > 하위");
});

test("detectDrivePathText: 자연어 중첩 폴더 경로", () => {
  assert.equal(detectDrivePathText("구글 드라이브 폴더 내 3디와이 폴더 하위의 SAP 폴더 봐줘"), "3디와이 > SAP");
  // "구글 드라이브 폴더"의 '드라이브' 자체는 경로 세그먼트가 아니다 → 세그먼트 0개 → 빈 문자열
  assert.equal(detectDrivePathText("구글 드라이브 폴더 열어줘"), "");
});

test("detectDrivePathText: '내 드라이브 > A > B'", () => {
  assert.equal(detectDrivePathText("내 드라이브 > 업무 > QM 정리해줘"), "내 드라이브 > 업무 > QM");
});

test("detectDrivePathText: Drive 신호가 없으면 빈 문자열", () => {
  assert.equal(detectDrivePathText("오늘 날씨 어때"), "");
});

test("detectDriveLink: file/folder/docs 링크 형태별 ID 추출", () => {
  assert.deepEqual(detectDriveLink("https://drive.google.com/file/d/1AbCdEfGhIjK/view"), { fileId: "1AbCdEfGhIjK" });
  assert.deepEqual(detectDriveLink("https://drive.google.com/drive/u/0/folders/1FolderIdXyz"), { folderId: "1FolderIdXyz" });
  assert.deepEqual(detectDriveLink("https://docs.google.com/spreadsheets/d/1SheetIdAbc/edit"), { fileId: "1SheetIdAbc" });
  assert.equal(detectDriveLink("https://example.com/file/d/short"), null);
});

test("extractSearchKeywords: 식별자형 토큰 우선, 노이즈 제거, 최대 6개", () => {
  const kw = extractSearchKeywords("#구글드라이브 QM008 폴더에서 ZAQMR0110 소스 분석해줘 https://x.y/z");
  assert.equal(kw[0], "QM008", "식별자형이 앞");
  assert.ok(kw.includes("ZAQMR0110"));
  assert.ok(!kw.includes("드라이브") && !kw.includes("분석"), "명령어/동사는 노이즈");
  assert.ok(kw.length <= 6);
});

test("condenseForQuery: 한도 이하면 그대로", () => {
  assert.deepEqual(condenseForQuery("짧은 글", ["아무거나"], 100), { text: "짧은 글", truncated: false });
});

test("condenseForQuery: 머리말 + 키워드 포함 단락을 우선 발췌", () => {
  const head = "H".repeat(300); // maxChars(160)를 넘겨 발췌 경로로 들어가게
  const text = [head, "무관한 내용입니다", "핵심 QM008 검사로트 설명", "또 무관"].join("\n\n");
  const out = condenseForQuery(text, ["QM008"], 160);
  assert.equal(out.truncated, true);
  assert.ok(out.text.startsWith("H"), "머리말 유지");
  assert.ok(out.text.includes("QM008"), "키워드 단락 포함");
  assert.ok(out.text.length <= 160);
});

test("condenseForQuery: 키워드가 없으면 앞부분만", () => {
  const out = condenseForQuery("a".repeat(500), [], 100);
  assert.equal(out.truncated, true);
  assert.equal(out.text.length, 100);
});
