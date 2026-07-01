// Server-side defense-in-depth: /api/workspace must not let a fully-empty POST
// overwrite an account's existing non-empty workspace_state (data-loss prevention).

import test from "node:test";
import assert from "node:assert/strict";
import { isEmptyJson, shouldSkipEmptyOverwrite } from "../lib/workspace-guard.js";

test("isEmptyJson recognizes empty/degenerate payloads", () => {
  for (const v of [null, undefined, "", "[]", "null", "{}"]) assert.equal(isEmptyJson(v), true, String(v));
  for (const v of ['[{"id":"r1"}]', '["x"]', "0"]) assert.equal(isEmptyJson(v), false, String(v));
});

test("blocks all-empty overwrite when existing row has data", () => {
  const incoming = { rooms: "[]", projects: "[]", posts: "[]" };
  const existing = { rooms_json: '[{"id":"r1"}]', projects_json: "[]", posts_json: "[]" };
  assert.equal(shouldSkipEmptyOverwrite(incoming, existing, false), true);
});

test("blocks even when only existing posts (notes) have data", () => {
  const incoming = { rooms: "[]", projects: "[]", posts: "[]" };
  const existing = { rooms_json: "[]", projects_json: "[]", posts_json: '[{"id":"n1"}]' };
  assert.equal(shouldSkipEmptyOverwrite(incoming, existing, false), true);
});

test("allows genuine empty save when nothing exists yet (brand-new user)", () => {
  const incoming = { rooms: "[]", projects: "[]", posts: "[]" };
  assert.equal(shouldSkipEmptyOverwrite(incoming, null, false), false);
  assert.equal(shouldSkipEmptyOverwrite(incoming, { rooms_json: "[]", projects_json: "[]", posts_json: "[]" }, false), false);
});

test("allows partial save (some data present) — deletions still sync", () => {
  const incoming = { rooms: '[{"id":"r1"}]', projects: "[]", posts: "[]" };
  const existing = { rooms_json: '[{"id":"old"}]', projects_json: '[{"id":"p"}]', posts_json: "[]" };
  assert.equal(shouldSkipEmptyOverwrite(incoming, existing, false), false);
});

test("force flag overrides the guard (explicit delete-all)", () => {
  const incoming = { rooms: "[]", projects: "[]", posts: "[]" };
  const existing = { rooms_json: '[{"id":"r1"}]', projects_json: "[]", posts_json: "[]" };
  assert.equal(shouldSkipEmptyOverwrite(incoming, existing, true), false);
});
