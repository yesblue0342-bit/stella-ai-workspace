// 메타DB 풀 재연결(resilience) 단위 테스트 — 라이브 DB 없이 순수 판별 로직만 검증.
// 대상: isPoolDeadError(끊김 에러 판별) / shouldReusePool(풀 재사용 판별) / resetPool·withPool.
import test from "node:test";
import assert from "node:assert/strict";
import { isPoolDeadError, shouldReusePool, withPool, resetPool } from "../lib/db.js";

test("API 표면: 새 resilience 함수가 export 되어 있다", () => {
  assert.equal(typeof isPoolDeadError, "function");
  assert.equal(typeof shouldReusePool, "function");
  assert.equal(typeof withPool, "function");
  assert.equal(typeof resetPool, "function");
  assert.doesNotThrow(() => resetPool("noop"), "캐시 없을 때 resetPool 은 무해해야");
});

test("isPoolDeadError: 끊김/치명적 에러코드는 true", () => {
  for (const code of ["ECONNCLOSED", "ECONNRESET", "ETIMEOUT", "ENOTOPEN", "ESOCKET", "EPIPE", "ENOTFOUND", "ECONNREFUSED"]) {
    assert.equal(isPoolDeadError({ code }), true, `${code} → dead`);
    assert.equal(isPoolDeadError({ code: code.toLowerCase() }), true, `${code} 소문자 → dead`);
  }
});

test("isPoolDeadError: 메시지 패턴으로도 감지", () => {
  assert.equal(isPoolDeadError(new Error("Connection is closed.")), true);
  assert.equal(isPoolDeadError(new Error("Connection lost - read ECONNRESET")), true);
  assert.equal(isPoolDeadError(new Error("Connection to stella-mssql:1433 is closed")), true);
  assert.equal(isPoolDeadError(new Error("socket hang up")), true);
});

test("isPoolDeadError: 일반 쿼리/제약 에러는 false (풀 폐기 금지)", () => {
  assert.equal(isPoolDeadError(null), false);
  assert.equal(isPoolDeadError(undefined), false);
  assert.equal(isPoolDeadError(new Error("Violation of PRIMARY KEY constraint")), false);
  assert.equal(isPoolDeadError(new Error("Invalid object name 'dbo.chat_index'")), false);
  assert.equal(isPoolDeadError({ code: "EREQUEST" }), false);
});

test("shouldReusePool: 연결됨/연결중이면 재사용", () => {
  assert.equal(shouldReusePool({ connected: true, connecting: false }), true);
  assert.equal(shouldReusePool({ connected: false, connecting: true }), true);
});

test("shouldReusePool: 닫힌 풀은 폐기, 없으면 폐기", () => {
  assert.equal(shouldReusePool({ connected: false, connecting: false }), false);
  assert.equal(shouldReusePool(null), false);
  assert.equal(shouldReusePool(undefined), false);
});

test("shouldReusePool: connected/connecting 미노출 버전은 보수적 재사용", () => {
  assert.equal(shouldReusePool({}), true);
});

// withPool 의 dead-pool 재시도 분기는 getPool(라이브 mssql 연결) 의존이라 단위 격리가 어렵다.
// → 재시도 판단의 핵심인 isPoolDeadError 의 진리표를 위에서 망라 검증하는 것으로 갈음한다.
