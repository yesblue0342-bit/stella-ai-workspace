// 메타데이터 DB 설정/TLS 판별 단위 테스트 — OCI 동거 DB 마이그레이션 안전망.
// 라이브 DB 연결 없이 buildDbConfig/describeDbTarget 의 순수 로직만 검증.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDbConfig, describeDbTarget } from "../lib/db.js";

const DB_KEYS = [
  "SQL_CONNECTION_STRING", "AZURE_SQL_CONNECTION_STRING", "AZURE_SQL_CONNECTIONSTRING",
  "DATABASE_URL", "DB_CONNECTION_STRING",
  "DB_USER", "SQL_USER", "AZURE_SQL_USER", "CL_DB_USR",
  "DB_PASSWORD", "SQL_PASSWORD", "AZURE_SQL_PASSWORD", "CL_DB_PW",
  "DB_SERVER", "SQL_SERVER", "AZURE_SQL_SERVER", "CL_DB_SV",
  "DB_NAME", "DB_DATABASE", "SQL_DATABASE", "AZURE_SQL_DATABASE", "CL_DB_NM",
  "DB_PORT", "SQL_PORT",
  "DB_ENCRYPT", "SQL_ENCRYPT",
  "DB_TRUST_SERVER_CERT", "DB_TRUST_CERT", "SQL_TRUST_SERVER_CERTIFICATE"
];
function clearDb() { for (const k of DB_KEYS) delete process.env[k]; }
function creds(server) {
  process.env.DB_USER = "u";
  process.env.DB_PASSWORD = "p";
  process.env.DB_SERVER = server;
  process.env.DB_NAME = "d";
}

test("connection string 우선 — 그대로 반환(패스스루)", () => {
  clearDb();
  process.env.DATABASE_URL = "Server=tcp:x;Database=y;TrustServerCertificate=true";
  const cfg = buildDbConfig();
  assert.equal(typeof cfg, "string");
  assert.match(cfg, /TrustServerCertificate=true/);
  assert.equal(describeDbTarget().mode, "connection-string");
});

test("Azure 호스트 — 기존 동작 유지(encrypt O / 검증 O)", () => {
  clearDb();
  creds("stella.database.windows.net");
  const o = buildDbConfig().options;
  assert.equal(o.encrypt, true);
  assert.equal(o.trustServerCertificate, false);
  assert.equal(describeDbTarget().mode, "azure");
});

test("localhost — 자체서명 허용(trustServerCertificate=true)", () => {
  clearDb();
  creds("localhost");
  const o = buildDbConfig().options;
  assert.equal(o.encrypt, true);
  assert.equal(o.trustServerCertificate, true);
  assert.equal(describeDbTarget().mode, "oci-local");
});

test("컨테이너 호스트명(stella-mssql, 점 없음) — oci-local + trust", () => {
  clearDb();
  creds("stella-mssql");
  assert.equal(buildDbConfig().options.trustServerCertificate, true);
  assert.equal(describeDbTarget().mode, "oci-local");
});

test("사설 IP(10.x) — trust true", () => {
  clearDb();
  creds("10.0.1.5");
  assert.equal(buildDbConfig().options.trustServerCertificate, true);
});

test("공개 IP/호스트 — 기본 검증 O(trust false)", () => {
  clearDb();
  creds("db.example.com");
  const o = buildDbConfig().options;
  assert.equal(o.trustServerCertificate, false);
  assert.equal(describeDbTarget().mode, "custom");
});

test("DB_TRUST_SERVER_CERT=false 오버라이드 — localhost라도 검증 O", () => {
  clearDb();
  creds("localhost");
  process.env.DB_TRUST_SERVER_CERT = "false";
  assert.equal(buildDbConfig().options.trustServerCertificate, false);
});

test("DB_TRUST_SERVER_CERT=true 오버라이드 — Azure라도 자체서명 허용", () => {
  clearDb();
  creds("stella.database.windows.net");
  process.env.DB_TRUST_SERVER_CERT = "1";
  assert.equal(buildDbConfig().options.trustServerCertificate, true);
});

test("DB_ENCRYPT=false 오버라이드 — 암호화 끔(순수 로컬)", () => {
  clearDb();
  creds("localhost");
  process.env.DB_ENCRYPT = "false";
  assert.equal(buildDbConfig().options.encrypt, false);
});

test("포트 기본 1433 / 커스텀 반영", () => {
  clearDb();
  creds("stella-mssql");
  assert.equal(buildDbConfig().port, 1433);
  process.env.DB_PORT = "14333";
  assert.equal(buildDbConfig().port, 14333);
});

test("필수 env 누락 — STELLA_DB_ENV_MISSING throw", () => {
  clearDb();
  process.env.DB_USER = "u"; // server/name/password 누락
  assert.throws(() => buildDbConfig(), (e) => e.code === "STELLA_DB_ENV_MISSING");
});

test("CL_DB_* 별칭으로도 구성 가능(clover 호환)", () => {
  clearDb();
  process.env.CL_DB_USR = "u";
  process.env.CL_DB_PW = "p";
  process.env.CL_DB_SV = "stella-mssql";
  process.env.CL_DB_NM = "d";
  const cfg = buildDbConfig();
  assert.equal(cfg.user, "u");
  assert.equal(cfg.server, "stella-mssql");
  assert.equal(cfg.options.trustServerCertificate, true);
});
