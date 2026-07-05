// lib/codex-db.mjs 단위 테스트 — DB 미연결(이 개발 환경엔 DB_SERVER 미설정)에서도 절대 throw 하지 않고
// 안전한 폴백을 반환하는지 검증(lib/cc-db.mjs와 동일한 graceful 철학). 실제 SQL 라운드트립은
// 서버 인프라가 필요해 이 테스트 범위 밖 — 여기서는 "DB 실패해도 앱이 안 죽는다"만 보증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listCodexChats, getCodexChat, saveCodexChat } from "../lib/codex-db.mjs";

test("listCodexChats: DB 미연결/실패 시 빈 배열(throw 안 함)", async () => {
  const items = await listCodexChats();
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 0);
});

test("getCodexChat: DB 미연결/실패 시 null(throw 안 함)", async () => {
  const chat = await getCodexChat("nonexistent-id");
  assert.equal(chat, null);
});

test("saveCodexChat: DB 미연결/실패 시 false 반환(throw 안 함, 채팅 자체는 계속 동작)", async () => {
  const ok = await saveCodexChat({ id: "test-id", title: "t", model: "gpt-4.1-mini", messages: [{ role: "user", content: "hi" }] });
  assert.equal(ok, false);
});

test("saveCodexChat: messages가 배열이 아니어도 크래시하지 않는다", async () => {
  const ok = await saveCodexChat({ id: "test-id-2", title: "t", model: "gpt-4.1-mini", messages: null });
  assert.equal(typeof ok, "boolean");
});
