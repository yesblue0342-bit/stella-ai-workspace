// lib/drive/client.js — Google Drive 인증 클라이언트와 환경변수 해석.
// lib/drive-utils.js(1057줄) 분리의 일부. 다른 drive/* 모듈이 모두 이 모듈 위에 얹힌다.

import { google } from "googleapis";

export const JSON_MIME = "application/json";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDE_MIME = "application/vnd.google-apps.presentation";
export const GOOGLE_DRAWING_MIME = "application/vnd.google-apps.drawing";

// 공유 드라이브(Shared Drive) + 공유받은 파일까지 검색·읽기에 포함 (My Drive만 있어도 무해)
export const ALL_DRIVES_LIST = { includeItemsFromAllDrives: true, supportsAllDrives: true };
export const ALL_DRIVES = { supportsAllDrives: true };

function normalizeEnvValue(value = "") {
  return String(value || "")
    .trim()
    .replace(/^[']|[']$/g, "")
    .replace(/^["]|["]$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function envAny(names = []) {
  for (const name of names) {
    const value = normalizeEnvValue(process.env[name]);
    if (value) return value;
  }
  return "";
}

function mustEnvAny(names = []) {
  const value = envAny(names);
  if (!value) throw new Error(`${names[0]} not configured`);
  return value;
}

const ROOT_ID_ENVS = ["GOOGLE_DRIVE_FOLDER_ID", "GOOGLE_FOLDER_ID", "STELLA_DRIVE_FOLDER_ID", "DRIVE_FOLDER_ID"];

/**
 * 폴더 ID 정규화 — 사용자가 env 에 '폴더 URL 전체'를 넣어도 ID만 추출.
 * ★실사고: OCI .env 의 GOOGLE_DRIVE_FOLDER_ID 에 https://drive.google.com/drive/folders/<ID>
 *   URL이 통째로 들어가 'File not found: .' 로 6/26부터 모든 서버측 Drive 쓰기가 마비됐었음.
 */
export function normalizeDriveFolderId(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return s.replace(/[?#].*$/, "");
}

export function getDriveRootId() {
  return normalizeDriveFolderId(mustEnvAny(ROOT_ID_ENVS));
}

/** env 에서만 읽는 루트 ID (없으면 빈 문자열). getDriveRootIdSafe 가 자동 탐색 폴백을 담당. */
export function getRootIdFromEnv() {
  return normalizeDriveFolderId(envAny(ROOT_ID_ENVS));
}

// ★ 노트 전용 고정 폴더 — 로그인 계정(uid)에 상관없이 항상 이 한 폴더에만 노트를 쌓는다.
//   사고: 로그인 방식마다 uid 가 달라져(users/yesblue0342 vs users/stellanight …) 노트가
//   서로 다른 users/<uid>/notes 폴더로 흩어졌고, 로그인마다 "노트를 못 읽는" 원인이 됐다.
//   폴더 ID는 비밀이 아님(공유 링크 값). 운영에선 STELLA_NOTES_FOLDER_ID 로 재정의 가능.
const DEFAULT_NOTES_FOLDER_ID = "1Gd_4isQFTIQi0DjaDfE85IZM-tG1cClZ";
export function getNotesFolderId() {
  return normalizeDriveFolderId(envAny(["STELLA_NOTES_FOLDER_ID", "NOTES_FOLDER_ID"])) || DEFAULT_NOTES_FOLDER_ID;
}

function driveEnv() {
  return {
    clientId: mustEnvAny(["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_ID"]),
    clientSecret: mustEnvAny(["GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_DRIVE_CLIENT_SECRET"]),
    refreshToken: mustEnvAny(["GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN", "DRIVE_REFRESH_TOKEN"]),
    redirectUri: envAny(["GOOGLE_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"]) || "https://developers.google.com/oauthplayground",
  };
}

function oauthClient() {
  const env = driveEnv();
  const auth = new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
  auth.setCredentials({ refresh_token: env.refreshToken });
  return auth;
}

export function getDrive() {
  return google.drive({ version: "v3", auth: oauthClient() });
}

/** 기존 OAuth2(refresh token) 인증을 재사용해 raw access token 발급 (api/download.js 스트리밍용) */
export async function getDriveAccessToken() {
  const { token } = await oauthClient().getAccessToken();
  if (!token) throw new Error("Drive access token 획득 실패");
  return token;
}

function describeSecret(value, type) {
  const v = normalizeEnvValue(value);
  if (!v) return { configured: false, length: 0, prefix: "", suffix: "" };
  // ⚠️ /api/drive-diagnostics는 무인증 공개 엔드포인트다. 진짜 시크릿(clientSecret/refreshToken)의
  //    prefix+suffix(합계 최대 18자)+정확한 길이를 노출하면 익명 공격자에게 자격증명 일부를
  //    그대로 넘겨주는 것 → 시크릿류는 존재 여부/길이만 알려준다.
  //    비밀 아님(clientId는 공개값, folderId는 URL 오설정 진단에 prefix가 필요)은 기존 유지.
  if (type === "clientSecret" || type === "refreshToken") {
    return { configured: true, length: v.length, prefix: "", suffix: "" };
  }
  return { configured: true, length: v.length, prefix: v.slice(0, 10), suffix: v.slice(-8) };
}

export function getDriveEnvDiagnostics() {
  const clientId = envAny(["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_ID"]);
  const clientSecret = envAny(["GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_DRIVE_CLIENT_SECRET"]);
  const refreshToken = envAny(["GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN", "DRIVE_REFRESH_TOKEN"]);
  const rootId = envAny(ROOT_ID_ENVS);
  const redirectUri = envAny(["GOOGLE_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"]);
  return {
    clientId: describeSecret(clientId, "clientId"),
    clientSecret: describeSecret(clientSecret, "clientSecret"),
    refreshToken: describeSecret(refreshToken, "refreshToken"),
    rootFolderId: describeSecret(rootId, "folderId"),
    redirectUri: redirectUri || "https://developers.google.com/oauthplayground",
    checks: {
      clientIdLooksOAuth: /\.apps\.googleusercontent\.com$/.test(clientId),
      clientSecretLooksOAuth: /^GOCSPX-|^[A-Za-z0-9_-]{20,}$/.test(clientSecret) && !/^AIza/.test(clientSecret) && !/^sk_/.test(clientSecret),
      refreshTokenLooksGoogle: /^1\/\//.test(refreshToken),
      rootFolderConfigured: Boolean(rootId),
    },
  };
}

/** Google API 오류를 사용자가 고칠 수 있는 한국어 안내로 바꾼다. */
export function normalizeDriveError(error) {
  const raw = error?.response?.data || error?.errors || error?.message || error;
  const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (/invalid_client/i.test(msg)) return "Google OAuth invalid_client: GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET이 같은 OAuth 클라이언트 세트인지 확인하세요.";
  if (/invalid_grant/i.test(msg)) return "Google OAuth invalid_grant: GOOGLE_REFRESH_TOKEN이 만료/폐기되었거나 다른 OAuth 클라이언트에서 발급된 값입니다.";
  if (/not configured/i.test(msg)) return msg;
  return error?.message || msg || "Google Drive error";
}

// ───────── 이름/질의 정규화 (순수) ─────────

export function escapeQuery(value = "") { return String(value).replace(/'/g, "\\'"); }
export function cleanName(value = "file") { return String(value || "file").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 150) || "file"; }
export function normalizeFolderName(value = "") { return String(value || "").trim().replace(/^#/, ""); }
export function rootAlias(value = "") {
  const v = String(value || "").trim().toLowerCase();
  return v === "root" || v === "mydrive" || v === "drive" || v === "all" || v === "전체" || v === "내드라이브" || v === "내 드라이브";
}

/** 파일/폴더 id로 Google Drive 열기 링크 생성 (별도 webViewLink 불필요) */
export function driveFileLink(f) {
  if (!f || !f.id) return "";
  const isFolder = f.isFolder || f.mimeType === FOLDER_MIME;
  return isFolder
    ? `https://drive.google.com/drive/folders/${f.id}`
    : `https://drive.google.com/file/d/${f.id}/view`;
}
