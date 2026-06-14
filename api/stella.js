import { saveJsonToDrive, listJsonFromDrive, searchDrive, listDriveDirectory } from "../lib/drive-utils.js";
import { getPlaceContext, getWeatherContext } from "../lib/place-weather-utils.js";
import { getPool, sql } from "../lib/db.js";

const ROUTE_ACTIONS = {
  "board-list": "board-list",
  "board-save": "board-save",
  "chat-list": "chat-list",
  "chat-save": "chat-save",
  "db-test": "db-test",
  "drive-search": "drive-search",
  "drive-test": "drive-test",
  "member-chat-list": "member-chat-list",
  "member-chat-save": "member-chat-save",
  "place-search": "place-search",
  "weather-search": "weather-search",
  "pwa-manifest": "pwa-manifest",
  "init-db": "init-db"
};

export default async function handler(req, res) {
  const action = getAction(req);
  try {
    switch (action) {
      case "health": return res.status(200).json({ ok: true, service: "stella", message: "Stella 통합 API 정상" });
      case "pwa-manifest": return sendManifest(res);
      case "db-test": return await handleDbTest(res);
      case "drive-test": return await handleDriveTest(req, res);
      case "drive-search": return await handleDriveSearch(req, res);
      case "drive-directory":
      case "db-directory": return await handleDriveDirectory(req, res);
      case "board-save": return await handleBoardSave(req, res);
      case "board-list": return await handleBoardList(req, res);
      case "chat-save": return await handleChatSave(req, res);
      case "chat-list": return await handleChatList(req, res);
      case "member-chat-save": return await handleMemberChatSave(req, res);
      case "member-chat-list": return await handleMemberChatList(req, res);
      case "place-search": return await handlePlaceSearch(req, res);
      case "weather-search": return await handleWeatherSearch(req, res);
      case "assistant-save": return await handleAssistantSave(req, res);
      case "assistant-list": return await handleAssistantList(req, res);
      case "db-list":
      case "db-file-list": return await handleDbFileList(req, res);
      case "init-db":
      case "init-index": {
        try {
          const mod = await import("./init-index-db.js");
          return await mod.default(req, res);
        } catch (e) {
          return res.status(500).json({ ok: false, message: "인덱스 초기화 실패", error: e.message });
        }
      }
      default: return res.status(400).json({ ok: false, message: "Unknown Stella action", action });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, action, message: "Stella 통합 API 오류", error: error.message });
  }
}

function getAction(req) {
  const queryAction = clean(req.query?.action || req.body?.action).toLowerCase();
  if (queryAction) return queryAction;
  const rawUrl = req.url || "";
  const path = rawUrl.split("?")[0].split("/").filter(Boolean).pop() || "health";
  return ROUTE_ACTIONS[path] || path || "health";
}

function clean(value = "") { return String(value || "").trim(); }
function getInput(req, names = []) {
  for (const name of names) {
    const value = req.query?.[name] ?? req.body?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}
function safeId(value = "", fallback = "item") {
  const raw = clean(value) || `${fallback}_${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 100);
}
function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && (item.content || item.text || item.message)).map((item, index) => ({
    id: clean(item.id) || `msg_${Date.now()}_${index}`,
    role: item.role === "assistant" || item.role === "ai" ? "assistant" : "user",
    content: String(item.content || item.text || item.message || ""),
    createdAt: clean(item.createdAt) || new Date().toISOString()
  }));
}

function sendManifest(res) {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  return res.status(200).send(JSON.stringify({ name: "Stella Workspace", short_name: "Stella", start_url: "/", display: "standalone", background_color: "#ffffff", theme_color: "#0f172a", icons: [] }));
}
async function handleDbTest(res) {
  const pool = await getPool();
  const result = await pool.request().query("SELECT 1 AS ok");
  return res.status(200).json({ ok: true, message: "DB 연결 성공", result: result.recordset });
}
async function handleDriveTest(req, res) {
  const saved = await saveJsonToDrive({ folderPath: ["SystemTest"], fileName: "drive-test.json", data: { type: "driveTest", message: "Stella Google Drive save test", method: req.method, createdAt: new Date().toISOString() } });
  return res.status(200).json({ ok: true, message: "Google Drive 저장 테스트 완료", saved });
}
function normalizeDriveQuery(value = "") {
  return String(value || "").replace(/#DB/gi, "").replace(/#SAP/gi, "").replace(/#StellaGPT/gi, "").replace(/구글\s*드라이브|Drive|Knowledge|내\s*문서|자료\s*기준|폴더에서|검색해줘|찾아줘|검색|찾아/gi, " ").replace(/\s+/g, " ").trim();
}
async function handleDriveSearch(req, res) {
  if (req.method !== "GET" && req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ ok: false, message: "Method Not Allowed" }); }
  const raw = getInput(req, ["q", "query", "message"]);
  const query = normalizeDriveQuery(raw) || clean(raw);
  const limit = Math.min(Number(getInput(req, ["limit"]) || 20), 100);
  if (!query) return res.status(400).json({ ok: false, message: "검색어를 입력하세요." });
  // # 키워드 포함 시 전체 Drive 검색, 기본은 StellaGPT 폴더 내 검색
  const isFullSearch = /^#|\s#/.test(raw);
  const searchOptions = { query, pageSize: Number.isFinite(limit) ? limit : 20 };
  if (!isFullSearch) searchOptions.folderName = "StellaGPT";
  const result = await searchDrive(searchOptions);
  const files = Array.isArray(result) ? result : (result.files || []);
  return res.status(200).json({ ok: true, type: "drive-search", query, scope: isFullSearch ? "all" : "StellaGPT", files: files.map(mapDriveFile) });
}
async function handleDriveDirectory(req, res) {
  const folderId = clean(getInput(req, ["folderId", "id"]));
  const limit = Math.min(Number(getInput(req, ["limit"]) || 100), 200);
  const files = await listDriveDirectory({ folderId: folderId || undefined, pageSize: Number.isFinite(limit) ? limit : 100 });
  return res.status(200).json({ ok: true, type: "drive-directory", folderId: folderId || "root", files });
}
async function handleBoardSave(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, message: "Method Not Allowed" }); }
  const body = req.body || {};
  const title = clean(body.title);
  const content = clean(body.content || body.body || body.text);
  const writer = clean(body.writer || body.userName || body.name || "unknown");
  const userId = clean(body.userId || body.email || writer || "unknown");
  const category = clean(body.category || "Board");
  const postId = safeId(body.postId || body.id || title, "post");
  if (!title && !content) return res.status(400).json({ ok: false, message: "제목 또는 내용을 입력하세요." });
  const data = { type: "boardPost", postId, title: title || "제목 없음", content, writer, userId, category, attachments: Array.isArray(body.attachments) ? body.attachments : [], createdAt: body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  // 1) Google Drive에 원문 JSON 저장
  const saved = await saveJsonToDrive({ folderPath: ["Board", category], fileName: `${postId}.json`, data });
  // 2) Azure SQL board_index에 인덱스 저장 (Drive 실패와 무관하게 보호)
  try {
    const pool = await getPool();
    await pool.request().query(`IF OBJECT_ID('dbo.board_index','U') IS NULL CREATE TABLE dbo.board_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,post_id NVARCHAR(100) NOT NULL,category NVARCHAR(100) NULL,title NVARCHAR(255) NULL,writer NVARCHAR(100) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`);
    await pool.request()
      .input("user_id", sql.NVarChar(100), userId)
      .input("post_id", sql.NVarChar(100), postId)
      .input("category", sql.NVarChar(100), category)
      .input("title", sql.NVarChar(255), data.title)
      .input("writer", sql.NVarChar(100), writer)
      .input("drive_file_id", sql.NVarChar(255), saved?.id || null)
      .input("drive_link", sql.NVarChar(1000), saved?.webViewLink || null)
      .query(`IF EXISTS(SELECT 1 FROM dbo.board_index WHERE post_id=@post_id) UPDATE dbo.board_index SET category=@category,title=@title,writer=@writer,drive_file_id=@drive_file_id,drive_link=@drive_link,updated_at=SYSUTCDATETIME() WHERE post_id=@post_id ELSE INSERT INTO dbo.board_index(user_id,post_id,category,title,writer,drive_file_id,drive_link) VALUES(@user_id,@post_id,@category,@title,@writer,@drive_file_id,@drive_link)`);
  } catch (e) { /* 인덱스 실패해도 게시글 저장은 성공 처리 */ }
  return res.status(200).json({ ok: true, message: "게시글 저장 완료", saved, post: data });
}
async function handleBoardList(req, res) {
  const category = clean(getInput(req, ["category"]) || "Board");
  const limit = Math.min(Number(getInput(req, ["limit"]) || 50), 100);
  const files = await listJsonFromDrive({ folderPath: ["Board", category], pageSize: Number.isFinite(limit) ? limit : 50 });
  return res.status(200).json({ ok: true, type: "board-list", category, posts: files.map(mapDriveFile) });
}
async function handleChatSave(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, message: "Method Not Allowed" }); }
  const body = req.body || {};
  const userId = clean(body.userId || body.email || body.user || "guest");
  const chatId = safeId(body.chatId || body.id || body.title, "chat");
  const title = clean(body.title || body.name || "Stella GPT Chat");
  const messages = normalizeMessages(body.messages || body.history);
  if (messages.length === 0) return res.status(400).json({ ok: false, message: "저장할 채팅 메시지가 없습니다." });
  const data = { type: "stellaGptChat", userId, chatId, title, model: clean(body.model || ""), messages, messageCount: messages.length, updatedAt: new Date().toISOString() };
  const saved = await saveJsonToDrive({ folderPath: ["ChatHistory", userId], fileName: `${chatId}.json`, data });
  return res.status(200).json({ ok: true, message: "Stella GPT 채팅 저장 완료", saved, chat: data });
}
async function handleChatList(req, res) {
  const userId = clean(getInput(req, ["userId", "email"]) || "guest");
  const limit = Math.min(Number(getInput(req, ["limit"]) || 50), 100);
  const files = await listJsonFromDrive({ folderPath: ["ChatHistory", userId], pageSize: Number.isFinite(limit) ? limit : 50 });
  return res.status(200).json({ ok: true, message: "Stella GPT 채팅 목록 조회 완료", userId, count: files.length, files });
}
async function handleMemberChatSave(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, message: "Method Not Allowed" }); }
  const body = req.body || {};
  const roomId = safeId(body.roomId || body.room || body.title, "default-room");
  const title = clean(body.title || body.roomName || roomId);
  const sender = clean(body.sender || body.userName || body.name || "unknown");
  const userId = clean(body.userId || body.email || sender || "unknown");
  const message = clean(body.message || body.text || body.content);
  const members = Array.isArray(body.members) ? body.members.map(clean).filter(Boolean) : [userId].filter(Boolean);
  if (!message) return res.status(400).json({ ok: false, message: "메시지를 입력하세요." });
  const messageItem = { id: `msg_${Date.now()}`, sender, userId, message, createdAt: new Date().toISOString() };
  const data = { type: "memberChat", roomId, title, members, lastMessage: message, updatedAt: new Date().toISOString(), messages: Array.isArray(body.messages) ? [...body.messages, messageItem] : [messageItem] };
  const saved = await saveJsonToDrive({ folderPath: ["MemberChat"], fileName: `${roomId}.json`, data });
  // Azure SQL member_chat_index 인덱스 저장
  try {
    const pool = await getPool();
    await pool.request().query(`IF OBJECT_ID('dbo.member_chat_index','U') IS NULL CREATE TABLE dbo.member_chat_index(id INT IDENTITY(1,1) PRIMARY KEY,room_id NVARCHAR(100) NOT NULL,title NVARCHAR(255) NULL,members NVARCHAR(1000) NULL,last_message NVARCHAR(1000) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`);
    await pool.request()
      .input("room_id", sql.NVarChar(100), roomId)
      .input("title", sql.NVarChar(255), title)
      .input("members", sql.NVarChar(1000), members.join(","))
      .input("last_message", sql.NVarChar(1000), message.slice(0, 1000))
      .input("drive_file_id", sql.NVarChar(255), saved?.id || null)
      .input("drive_link", sql.NVarChar(1000), saved?.webViewLink || null)
      .query(`IF EXISTS(SELECT 1 FROM dbo.member_chat_index WHERE room_id=@room_id) UPDATE dbo.member_chat_index SET title=@title,members=@members,last_message=@last_message,drive_file_id=@drive_file_id,drive_link=@drive_link,updated_at=SYSUTCDATETIME() WHERE room_id=@room_id ELSE INSERT INTO dbo.member_chat_index(room_id,title,members,last_message,drive_file_id,drive_link) VALUES(@room_id,@title,@members,@last_message,@drive_file_id,@drive_link)`);
  } catch (e) { /* 인덱스 실패 무시 */ }
  return res.status(200).json({ ok: true, message: "회원 채팅 저장 완료", saved, room: data });
}
async function handleMemberChatList(req, res) {
  const limit = Math.min(Number(getInput(req, ["limit"]) || 50), 100);
  const files = await listJsonFromDrive({ folderPath: ["MemberChat"], pageSize: Number.isFinite(limit) ? limit : 50 });
  return res.status(200).json({ ok: true, type: "member-chat-list", rooms: files.map(mapDriveFile) });
}
async function handlePlaceSearch(req, res) { const query = clean(getInput(req, ["q", "query"])); if (!query) return res.status(400).json({ ok: false, message: "q is required" }); const result = await getPlaceContext(query); return res.status(200).json({ ok: true, ...result }); }
async function handleWeatherSearch(req, res) { const query = clean(getInput(req, ["q", "query"])); if (!query) return res.status(400).json({ ok: false, message: "q is required" }); const result = await getWeatherContext(query); return res.status(200).json({ ok: true, ...result }); }
async function handleAssistantSave(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, message: "Method Not Allowed" }); }
  const body = req.body || {};
  const userId = safeId(body.userId || body.email || "guest", "user");
  const type = safeId(body.type || "memo", "memo");
  const itemId = safeId(body.id || body.title || type, "assistant");
  const data = { type: "assistantMemory", userId, category: type, title: clean(body.title || type), content: String(body.content || body.memo || body.text || ""), status: clean(body.status || "open"), createdAt: body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  const saved = await saveJsonToDrive({ folderPath: ["AssistantMemory", userId, type], fileName: `${itemId}.json`, data });
  return res.status(200).json({ ok: true, message: "개인 비서 메모 저장 완료", saved, item: data });
}
async function handleAssistantList(req, res) {
  const userId = safeId(getInput(req, ["userId", "email"]) || "guest", "user");
  const type = safeId(getInput(req, ["type"]) || "memo", "memo");
  const limit = Math.min(Number(getInput(req, ["limit"]) || 50), 100);
  const files = await listJsonFromDrive({ folderPath: ["AssistantMemory", userId, type], pageSize: Number.isFinite(limit) ? limit : 50 });
  return res.status(200).json({ ok: true, message: "개인 비서 메모 목록 조회 완료", userId, type, files });
}
async function handleDbFileList(req, res) {
  const query = clean(getInput(req, ["q", "query"]));
  const limit = Math.min(Number(getInput(req, ["limit"]) || 50), 100);
  if (!query) return await handleDriveDirectory(req, res);
  const files = await searchDrive({ query, pageSize: limit });
  return res.status(200).json({ ok: true, message: "DB 파일 목록 조회", files: files.map(mapDriveFile) });
}
function mapDriveFile(file) {
  return { id: file.id, name: file.name, mimeType: file.mimeType, isFolder: file.isFolder || file.mimeType === "application/vnd.google-apps.folder", link: file.link || file.webViewLink, modifiedTime: file.modifiedTime, createdTime: file.createdTime, size: file.size || null };
}

