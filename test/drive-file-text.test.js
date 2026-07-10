// lib/drive/file-text.js — 포맷별 텍스트 추출기 테스트.
// drive-utils.js(1057줄) 분리로 네트워크 없이 검증 가능해진 부분.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import {
  bufferToText, stripXml, extractXlsx, extractPptx, extractDocx, extractPdf,
  extractRegularFileText, isExtractableDriveFile,
} from "../lib/drive/file-text.js";

test("bufferToText: utf8 디코딩 + null/빈 버퍼 안전", () => {
  assert.equal(bufferToText(Buffer.from("한글 ok", "utf8")), "한글 ok");
  assert.equal(bufferToText(null), "");
});

test("stripXml: 태그 제거 + 엔티티 디코딩 + 공백 정규화", () => {
  assert.equal(stripXml("<a:t>Hello</a:t><a:t>World</a:t>"), "Hello World");
  assert.equal(stripXml("<p>a &amp; b &lt;c&gt;</p>"), "a & b <c>");
  assert.equal(stripXml(""), "");
});

test("extractXlsx: 시트별 탭 구분 텍스트", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["품번", "수량"], ["A-1", 3]]), "검사");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const out = extractXlsx(buf);
  assert.ok(out.includes("[Sheet: 검사]"));
  assert.ok(out.includes("품번\t수량"));
  assert.ok(out.includes("A-1\t3"));
});

test("extractPptx: 슬라이드 번호 순서대로 (10번이 2번 뒤로 가지 않는다)", () => {
  const zip = zipSync({
    "ppt/slides/slide1.xml": strToU8("<p><a:t>첫째</a:t></p>"),
    "ppt/slides/slide2.xml": strToU8("<p><a:t>둘째</a:t></p>"),
    "ppt/slides/slide10.xml": strToU8("<p><a:t>열째</a:t></p>"),
  });
  const out = extractPptx(Buffer.from(zip));
  assert.ok(out.indexOf("첫째") < out.indexOf("둘째"), "1 < 2");
  assert.ok(out.indexOf("둘째") < out.indexOf("열째"), "2 < 10 (문자열 정렬이면 10이 2보다 앞선다)");
  assert.ok(out.includes("[Slide 3]\n열째"));
});

test("extractDocx: mammoth 실패 시 fflate 로 word/document.xml 직접 파싱", async () => {
  const zip = zipSync({
    "word/document.xml": strToU8("<w:p><w:t>첫 문단</w:t></w:p><w:p><w:t>둘째 </w:t><w:t>문단 &amp; 끝</w:t></w:p>"),
  });
  const out = await extractDocx(Buffer.from(zip));
  assert.ok(out.includes("첫 문단"));
  assert.ok(out.includes("둘째 문단 & 끝"), "런(run) 병합 + 엔티티 디코딩");
});

test("extractDocx: 깨진 zip 이면 던지지 않고 빈 문자열", async () => {
  assert.equal(await extractDocx(Buffer.from("not a zip")), "");
});

test("extractPdf: Tj / TJ 연산자에서 텍스트 추출", () => {
  const pdf = Buffer.from("BT (Hello) Tj ET BT [(Wor)-250(ld)] TJ ET", "latin1");
  const out = extractPdf(pdf);
  assert.ok(out.includes("Hello"));
  assert.ok(out.includes("Wor") && out.includes("ld"));
});

test("extractPdf: 텍스트 스트림이 없으면 빈 문자열", () => {
  assert.equal(extractPdf(Buffer.from("%PDF-1.4 binary junk", "latin1")), "");
});

test("extractRegularFileText: 확장자/mime 로 추출기 선택", async () => {
  assert.equal(await extractRegularFileText({ name: "a.txt" }, Buffer.from("plain")), "plain");
  assert.equal(await extractRegularFileText({ name: "x", mimeType: "text/markdown" }, Buffer.from("md")), "md");
  assert.equal(await extractRegularFileText({ name: "movie.mp4", mimeType: "video/mp4" }, Buffer.from("")), "", "미지원 형식은 빈 문자열");
});

test("isExtractableDriveFile: 다운로드 전 사전 판정이 실제 추출 집합과 일치", () => {
  assert.equal(isExtractableDriveFile({ name: "spec.docx" }), true);
  assert.equal(isExtractableDriveFile({ name: "src.abap" }), true);
  assert.equal(isExtractableDriveFile({ name: "report.pdf" }), true);
  assert.equal(isExtractableDriveFile({ mimeType: "application/vnd.google-apps.document" }), true);
  assert.equal(isExtractableDriveFile({ name: "photo.png", mimeType: "image/png" }), false);
  assert.equal(isExtractableDriveFile({ name: "archive.zip", mimeType: "application/zip" }), false);
  assert.equal(isExtractableDriveFile({}), false);
});
