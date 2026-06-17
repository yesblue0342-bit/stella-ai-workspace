// Stella Sync Engine 단위/통합 테스트  (실행: `npm test` 또는 `node --test`)
import { test } from "node:test";
import assert from "node:assert/strict";
import "../lib/sync-engine.js";           // side-effect: globalThis.StellaSync 설정
const S = globalThis.StellaSync;

const T0 = 1_000_000_000_000;             // 기준 타임스탬프
const room = (id, name, t, extra) => Object.assign({ id, name, createdAt: new Date(t).toISOString(), updatedAt: t, messages: [] }, extra || {});

test("mergeById: id 기준 upsert — 중복 누적 없음 (append 회귀 차단)", () => {
  const local = [room("a", "A", T0), room("b", "B", T0 + 1)];
  const server = [room("a", "A", T0), room("c", "C", T0 + 2)];
  const merged = S.mergeById(local, server);
  assert.equal(merged.length, 3, "a,b,c 3개여야 함 (a 중복 병합)");
  assert.deepEqual(merged.map(r => r.id), ["a", "b", "c"]);
});

test("mergeById: 반복 병합해도 항목 수가 늘지 않음 (S4 멱등)", () => {
  const A = [room("a", "A", T0)], B = [room("b", "B", T0 + 1)];
  let m = S.mergeById(A, B);
  for (let i = 0; i < 10; i++) m = S.mergeById(m, S.mergeById(B, A));
  assert.equal(m.length, 2);
});

test("mergeById: LWW — updatedAt 최신 채택 (수정 전파, S2)", () => {
  const local = [room("a", "old-name", T0, { updatedAt: T0 })];
  const server = [room("a", "new-name", T0, { updatedAt: T0 + 5000 })];
  const merged = S.mergeById(local, server);
  assert.equal(merged[0].name, "new-name");
  // 반대 방향도 동일 결과(결정적)
  assert.equal(S.mergeById(server, local)[0].name, "new-name");
});

test("tombstone: 삭제가 전파되고 부활하지 않음 (S3)", () => {
  // A에서 삭제(tombstone), B에는 아직 살아있는 옛 버전
  const deleted = S.markDeleted(room("a", "A", T0, { updatedAt: T0 }));
  const aliveOld = room("a", "A", T0, { updatedAt: T0 });          // 더 과거
  const merged = S.mergeById([aliveOld], [deleted]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deleted, true, "삭제본이 이김");
  assert.equal(S.visible(merged).length, 0, "렌더 시 보이지 않음");
  // 한 번 더 동기화해도 부활 금지
  const again = S.mergeById(merged, [aliveOld]);
  assert.equal(S.visible(again).length, 0, "재동기화에도 부활하지 않음");
});

test("tombstone: 삭제 후 더 최신 수정이 오면 되살아남 (정상 LWW)", () => {
  // 통제된 타임스탬프로 tombstone 구성 (markDeleted는 실시간 Date.now() 사용하므로 단위테스트에선 직접 구성)
  const deleted = { id: "a", name: "A", createdAt: new Date(T0).toISOString(), updatedAt: T0 + 1000, deleted: true, deletedAt: T0 + 1000 };
  const revived = room("a", "A-edited", T0, { updatedAt: T0 + 9999 });
  const merged = S.mergeById([deleted], [revived]);
  assert.equal(S.visible(merged).length, 1, "더 최신 편집은 삭제를 이김");
  assert.equal(S.visible(merged)[0].name, "A-edited");
});

test("pruneTombstones: 오래된 삭제 표식만 정리", () => {
  const fresh = { id: "f", deleted: true, deletedAt: Date.now() };
  const old = { id: "o", deleted: true, deletedAt: Date.now() - 40 * 24 * 3600 * 1000 };
  const live = { id: "l", deleted: false };
  const out = S.pruneTombstones([fresh, old, live]);
  const ids = out.map(x => x.id).sort();
  assert.deepEqual(ids, ["f", "l"], "40일 지난 tombstone만 제거");
});

test("deterministicId: 같은 seed→같은 id, 다른 seed→다른 id (마이그레이션 멱등)", () => {
  assert.equal(S.deterministicId("hello"), S.deterministicId("hello"));
  assert.notEqual(S.deterministicId("hello"), S.deterministicId("world"));
});

test("ensureIds: id 없는 항목에 결정적 id 부여, 기존 id는 보존", () => {
  const items = [{ name: "x", createdAt: "2024-01-01" }, { id: "keep", name: "y" }];
  const withIds = S.ensureIds(items, { seedFn: it => (it.name || "") + "|" + (it.createdAt || "") });
  assert.ok(withIds[0].id && withIds[0].id.startsWith("det_"));
  assert.equal(withIds[1].id, "keep");
  // 멱등: 다시 부여해도 동일 id
  const again = S.ensureIds(withIds, { seedFn: it => (it.name || "") + "|" + (it.createdAt || "") });
  assert.equal(again[0].id, withIds[0].id);
});

test("dedupe: 같은 내용(제목+생성일+첫메시지) 중복을 1개로, 멱등 (S7)", () => {
  const mk = (id, msgs) => ({ id, name: "SAP QM CBO", createdAt: "2024-05-01T10:00:00Z", updatedAt: T0, messages: msgs });
  const dups = [
    mk("r1", [{ role: "user", text: "QM 모듈 개발" }, { role: "ai", text: "..." }]),
    mk("r2", [{ role: "user", text: "QM 모듈 개발" }]),                 // 메시지 적음
    mk("r3", [{ role: "user", text: "QM 모듈 개발" }, { role: "ai", text: "a" }, { role: "user", text: "b" }]) // 가장 많음
  ];
  const out = S.dedupe(dups, { keyFn: S.chatKey });
  assert.equal(out.length, 1, "내용 동일 3개 → 1개");
  assert.equal(out[0].id, "r3", "메시지 가장 많은 항목 보존");
  // 멱등: 다시 dedupe → 변화 없음 (no-op)
  const out2 = S.dedupe(out, { keyFn: S.chatKey });
  assert.deepEqual(out2.map(x => x.id), out.map(x => x.id));
  assert.equal(out2.length, 1);
});

test("dedupe: 서로 다른 내용은 합치지 않음", () => {
  const a = { id: "a", name: "채팅 A", createdAt: "2024-01-01", messages: [{ role: "user", text: "안녕" }] };
  const b = { id: "b", name: "채팅 B", createdAt: "2024-01-02", messages: [{ role: "user", text: "다른 질문" }] };
  assert.equal(S.dedupe([a, b], { keyFn: S.chatKey }).length, 2);
});

// ── 통합: 두 디바이스가 같은 Drive(SSOT)를 공유하는 시뮬레이션 ──
test("통합 2-device: 생성/수정/삭제 전파 + 중복 없음 수렴 (S1~S4)", () => {
  let drive = [];                                  // SSOT
  const pull = () => JSON.parse(JSON.stringify(drive));
  const push = (local) => { drive = S.mergeById(pull(), local); };

  // 디바이스 A,B 로컬 상태
  let A = [], B = [];

  // S1: A가 채팅 생성 → push → B가 pull
  A = S.mergeById(A, [room("c1", "갤럭시 S21 질문", T0 + 10, { updatedAt: T0 + 10 })]);
  push(A);
  B = S.mergeById(B, pull());
  assert.equal(S.visible(B).length, 1, "S1: B가 A의 새 채팅을 받음");

  // S2: B가 수정 → push → A가 pull
  B = S.mergeById(B, [room("c1", "갤럭시 S21 질문(수정)", T0 + 10, { updatedAt: T0 + 20 })]);
  push(B);
  A = S.mergeById(A, pull());
  assert.equal(S.visible(A)[0].name, "갤럭시 S21 질문(수정)", "S2: A에 수정 반영");

  // S3: A가 삭제 → push → B가 pull → 사라지고 부활 안 함
  const tomb = S.markDeleted(S.visible(A)[0]);
  A = S.mergeById(A, [tomb]);
  push(A);
  B = S.mergeById(B, pull());
  assert.equal(S.visible(B).length, 0, "S3: B에서도 삭제됨");

  // S4: 양쪽 번갈아 5회 동기화 → 항목 수(가시) 늘지 않음
  for (let i = 0; i < 5; i++) { push(A); B = S.mergeById(B, pull()); push(B); A = S.mergeById(A, pull()); }
  assert.equal(S.visible(A).length, 0, "S4: 부활/중복 없음");
  assert.equal(S.visible(B).length, 0);
  assert.equal(drive.length, 1, "tombstone 1개만 유지(물리 증식 없음)");
});

test("통합: id 없는 레거시 데이터도 결정적 id 부여 후 디바이스 간 동일 id로 수렴", () => {
  const legacy = { name: "노트1", createdAt: "2024-03-03", body: "내용" };
  const seedFn = it => S._norm(it.name) + "|" + (it.createdAt || "");
  const A = S.ensureIds([legacy], { prefix: "note_", seedFn });
  const B = S.ensureIds([JSON.parse(JSON.stringify(legacy))], { prefix: "note_", seedFn });
  assert.equal(A[0].id, B[0].id, "두 디바이스가 같은 결정적 id 생성");
  const merged = S.mergeById(A, B);
  assert.equal(merged.length, 1, "동일 id → 중복 아님");
});
