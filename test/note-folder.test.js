// 노트 고정 폴더 회귀 테스트 — 로그인 uid 변동으로 노트가 흩어지던 사고의 재발 방지.
// 핵심: getNotesFolderId() 가 로그인/uid 와 무관하게 항상 단일 폴더 ID 를 돌려준다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getNotesFolderId, normalizeDriveFolderId } from "../lib/drive-utils.js";

const PINNED = "1Gd_4isQFTIQi0DjaDfE85IZM-tG1cClZ";

test("기본값: 지정 폴더 ID 고정(env 미설정)", () => {
  delete process.env.STELLA_NOTES_FOLDER_ID;
  delete process.env.NOTES_FOLDER_ID;
  assert.equal(getNotesFolderId(), PINNED);
});

test("env 재정의: STELLA_NOTES_FOLDER_ID 우선", () => {
  const other = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  process.env.STELLA_NOTES_FOLDER_ID = other;
  assert.equal(getNotesFolderId(), other);
  delete process.env.STELLA_NOTES_FOLDER_ID;
});

test("env 에 폴더 URL 전체가 와도 ID 만 추출", () => {
  process.env.STELLA_NOTES_FOLDER_ID = `https://drive.google.com/drive/folders/${PINNED}?usp=sharing`;
  assert.equal(getNotesFolderId(), PINNED);
  delete process.env.STELLA_NOTES_FOLDER_ID;
});

test("빈 env → 기본값으로 폴백", () => {
  process.env.STELLA_NOTES_FOLDER_ID = "";
  assert.equal(getNotesFolderId(), PINNED);
  delete process.env.STELLA_NOTES_FOLDER_ID;
});

test("정규화 헬퍼 일관성", () => {
  assert.equal(normalizeDriveFolderId(PINNED), PINNED);
  assert.equal(normalizeDriveFolderId(`https://drive.google.com/drive/folders/${PINNED}`), PINNED);
});

test("api/note.js 가 고정 폴더 API 를 사용(소스 검증)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../api/note.js", import.meta.url), "utf8");
  assert.match(src, /getNotesFolderId/, "고정 폴더 헬퍼 사용");
  assert.match(src, /folderId:\s*NOTES_FOLDER_ID/, "저장/조회가 고정 폴더 ID 로 수행");
  assert.match(src, /sweepScatteredUserNotes/, "흩어진 users/*/notes 회수 로직 존재");
});
