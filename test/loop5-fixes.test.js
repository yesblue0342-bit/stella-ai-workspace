// Loop 5 회귀 테스트 모음
// - drive-diagnostics 시크릿 부분노출 차단(무인증 공개 엔드포인트)
// - download.js 스트림 오류 가드(프로세스 크래시 방지) — pipeline 사용 확인
// - chat-room send/invite: 읽기 오류를 새 방으로 오인해 덮어쓰지 않고 503 (소스 계약)
// - auth signup: 중복확인이 fail-closed (소스 계약)
// - note list: 저장소 완전 불통 + 0건이면 503 (소스 계약)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDriveEnvDiagnostics } from "../lib/drive-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("drive-diagnostics: clientSecret/refreshToken은 prefix/suffix를 노출하지 않는다", () => {
  const saved = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
  };
  try {
    process.env.GOOGLE_CLIENT_ID = "123456789-abcdefg.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-verysecretvalue1234567890";
    process.env.GOOGLE_REFRESH_TOKEN = "1//refreshtokensecret1234567890abcdef";
    const d = getDriveEnvDiagnostics();
    // 시크릿류: 존재/길이만, prefix/suffix 없음
    assert.equal(d.clientSecret.configured, true);
    assert.ok(d.clientSecret.length > 0);
    assert.equal(d.clientSecret.prefix, "");
    assert.equal(d.clientSecret.suffix, "");
    assert.equal(d.refreshToken.prefix, "");
    assert.equal(d.refreshToken.suffix, "");
    // clientId(공개값)와 folderId(URL 오설정 진단)는 prefix 유지 허용
    assert.ok(d.clientId.prefix.length > 0, "clientId는 공개값이라 prefix 유지");
    // 실제 시크릿 문자열이 응답 어디에도 통째로 담기지 않아야 함
    const blob = JSON.stringify(d);
    assert.doesNotMatch(blob, /verysecretvalue/);
    assert.doesNotMatch(blob, /refreshtokensecret/);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("download.js: pipe(res) 대신 stream/promises pipeline로 스트림 오류를 가드한다", () => {
  const src = read("api/download.js");
  assert.match(src, /from 'node:stream\/promises'/, "pipeline 임포트 필요");
  assert.match(src, /await pipeline\(/, "pipeline 사용 필요");
  // 실제 버그였던 무가드 파이프 호출(fromWeb(...).pipe(res))이 사라졌는지 확인(주석 언급은 무관).
  assert.doesNotMatch(src, /fromWeb\([^)]*\)\.pipe\(res\)/, "리스너 없는 .pipe(res) 호출은 프로세스 크래시 위험 — 제거되어야 함");
});

test("chat-room send: 읽기 오류를 삼키지 않고 503으로 중단(대화 소실 방지)", () => {
  const src = read("api/chat-room.js");
  // send/invite의 방 읽기가 더 이상 .catch(()=>null)로 오류를 삼키지 않아야 함
  assert.match(src, /채팅방을 잠시 읽지 못했습니다/);
  assert.match(src, /status\(503\)/);
});

test("auth signup: 중복확인 fail-closed(오류 시 503, 계정 덮어쓰기 방지)", () => {
  const src = read("api/auth.js");
  assert.match(src, /readUserStrict/, "오류를 rethrow하는 strict 중복확인 사용");
  assert.match(src, /signup dup-check failed/);
});

test("note list: 저장소 완전 불통 + 0건이면 503(빈 목록 오인 방지)", () => {
  const src = read("api/note.js");
  assert.match(src, /noteMap\.size === 0 && errors\.length > 0/);
  assert.match(src, /노트 저장소를 읽지 못했습니다/);
});

test("gh-file: zip 스트리밍 중 오류는 headersSent 분기로 소켓 파기(응답 무한 대기 방지)", () => {
  const src = read("api/gh-file.js");
  assert.match(src, /res\.headersSent/);
  assert.match(src, /res\.destroy\(\)/);
});
