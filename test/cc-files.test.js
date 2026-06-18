// 세션 파일 추출 테스트 (PART B). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFilesFromEvents, sanitizeRelPath } from "../lib/cc-files.mjs";

test("extractFilesFromEvents: write/create tool_use에서 파일 복원", () => {
  const events = [
    { seq: 1, kind: "tool_use", name: "write", input: { path: "a.py", content: "print(1)" } },
    { seq: 2, kind: "tool_use", name: "create_file", input: { file_path: "src/b.js", file_text: "export const x=1;" } },
    { seq: 3, kind: "tool_result", name: "write", result: "ok" },
    { seq: 4, kind: "text", text: "done" },
  ];
  const files = extractFilesFromEvents(events);
  assert.equal(files.length, 2);
  assert.deepEqual(files.find(f => f.path === "a.py"), { path: "a.py", content: "print(1)" });
  assert.equal(files.find(f => f.path === "src/b.js").content, "export const x=1;");
});

test("extractFilesFromEvents: 같은 경로는 최신 write 채택", () => {
  const events = [
    { seq: 1, kind: "tool_use", name: "write", input: { path: "a.txt", content: "v1" } },
    { seq: 2, kind: "tool_use", name: "write", input: { path: "a.txt", content: "v2" } },
  ];
  const files = extractFilesFromEvents(events);
  assert.equal(files.length, 1);
  assert.equal(files[0].content, "v2");
});

test("extractFilesFromEvents: write 아닌 tool은 무시", () => {
  const events = [
    { seq: 1, kind: "tool_use", name: "bash", input: { command: "ls" } },
    { seq: 2, kind: "tool_use", name: "read", input: { path: "a.py" } },
  ];
  assert.equal(extractFilesFromEvents(events).length, 0);
});

test("sanitizeRelPath: path traversal/선행 슬래시 제거", () => {
  assert.equal(sanitizeRelPath("/etc/passwd"), "etc/passwd");
  assert.equal(sanitizeRelPath("../../secret"), "secret");
  assert.equal(sanitizeRelPath("./src/a.js"), "src/a.js");
  assert.equal(sanitizeRelPath(""), "file");
});
