/*
 * Stella Talk 채팅 저장소 — 인메모리 캐시 + 방별 직렬화 쓰기 큐 + Drive write-through.
 *
 * 왜 필요한가(품질 사고의 뿌리):
 *  - 기존엔 폴링 1회(get)마다 Drive API ~4콜(ensurePath 2 + files.list 1 + files.get 1),
 *    방 목록(list) 1회마다 방 수×4콜을 클라이언트마다 매 2~3초 반복 → 지연 수 초 + 429 쿼터 고갈.
 *  - send/react/delete가 잠금 없는 read-modify-write → 동시 전송 시 마지막 쓰기가 이겨
 *    상대 메시지가 통째로 사라지는 유실 사고 가능.
 *
 * 설계(서버는 OCI 단일 장수 프로세스 = server.mjs, 이 모듈이 유일한 쓰기 주체):
 *  - 방 데이터/메타를 메모리에 캐시. 읽기(get/list/long-poll)는 Drive 호출 0회.
 *  - 쓰기는 방별 promise 체인으로 직렬화 → 동시 전송 유실 원천 차단.
 *  - Drive에는 write-through(캐시 갱신 + 즉시 파일 update). 파일 ID를 캐시해 쓰기 1회 = API 1콜.
 *    Drive 쓰기 실패 시 캐시를 롤백하고 throw → 기존과 동일하게 클라 재시도(clientId dedup)에 맡긴다.
 *  - typing은 휘발성이므로 메모리에만 둔다(기존: 타이핑마다 Drive 쓰기!). reads는 메모리 즉시 반영
 *    + 8초 디바운스 write-behind(재시작 시 몇 초치 읽음표시만 유실 — 허용).
 *  - 새 메시지 이벤트(EventEmitter) → chat-room-sse 롱폴이 Drive 폴링 없이 즉시 깨어난다.
 *  - 외부(다른 프로세스/수동 편집) 변경 대비: 60초마다 files.list 1콜로 modifiedTime을 비교해
 *    "우리가 쓰지 않은" 변경만 캐시 무효화한다.
 */
import { EventEmitter } from "events";
import { getDrive, getDriveRootIdSafe, FOLDER_MIME } from "./drive-utils.js";

const JSON_MIME = "application/json";
const CHAT_FOLDER = "MemberChat";
const INDEX_TTL_MS = 60 * 1000;        // 폴더 재검증 주기
const META_FLUSH_MS = 8 * 1000;        // reads write-behind 디바운스
const TYPING_TTL_MS = 10 * 1000;       // 오래된 typing 엔트리 청소

export const chatEvents = new EventEmitter();
chatEvents.setMaxListeners(0);

// ── 내부 상태 ──────────────────────────────────────────────
const rooms = new Map();   // roomId -> { data, fileId, loadedAt, localWriteAt }
const metas = new Map();   // roomId -> { reads, fileId, loadedAt, dirty, flushTimer }
const typing = new Map();  // roomId -> { [userId]: ts }  (메모리 전용)
const queues = new Map();  // lockKey -> promise (직렬화 체인)
let _folderId = null;
let _folderIdPromise = null;
let _index = { at: 0, files: new Map() }; // name(확장자 제거) -> { id, modifiedTime }
let _indexPromise = null;

const now = () => Date.now();
const cleanName = (v) => String(v || "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 150);
const fileNameOf = (roomId) => cleanName(roomId) + ".json";
const metaNameOf = (roomId) => cleanName(roomId) + "__meta.json";
const escapeQuery = (v = "") => String(v).replace(/'/g, "\\'");
const msgTime = (m) => { const t = new Date(m && m.createdAt).getTime(); return isNaN(t) ? 0 : t; };

// ── Drive I/O (테스트에서 통째로 교체 가능) ─────────────────
async function chatFolderId() {
  if (_folderId) return _folderId;
  if (!_folderIdPromise) {
    _folderIdPromise = (async () => {
      const drive = getDrive();
      const rootId = await getDriveRootIdSafe();
      const q = `mimeType='${FOLDER_MIME}' and name='${CHAT_FOLDER}' and '${escapeQuery(rootId)}' in parents and trashed=false`;
      const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1, includeItemsFromAllDrives: true, supportsAllDrives: true });
      if (found.data.files?.[0]) return found.data.files[0].id;
      const created = await drive.files.create({ requestBody: { name: CHAT_FOLDER, mimeType: FOLDER_MIME, parents: [rootId] }, fields: "id" });
      return created.data.id;
    })().then(
      (id) => { _folderId = id; return id; },
      (e) => { _folderIdPromise = null; throw e; }
    );
  }
  return _folderIdPromise;
}

const driveIo = {
  // 폴더 안 JSON 목록 → Map(name(확장자 제거) -> {id, modifiedTime})
  async listIndex() {
    const drive = getDrive();
    const folderId = await chatFolderId();
    const files = new Map();
    let pageToken;
    do {
      const r = await drive.files.list({
        q: `'${escapeQuery(folderId)}' in parents and mimeType='${JSON_MIME}' and trashed=false`,
        fields: "nextPageToken,files(id,name,modifiedTime)",
        pageSize: 1000, pageToken,
        includeItemsFromAllDrives: true, supportsAllDrives: true
      });
      for (const f of r.data.files || []) files.set(String(f.name || "").replace(/\.json$/, ""), { id: f.id, modifiedTime: f.modifiedTime });
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    return files;
  },
  // 이름으로 파일 ID 1건 조회(인덱스 미스 시 폴백)
  async findByName(fileName) {
    const drive = getDrive();
    const folderId = await chatFolderId();
    const q = `name='${escapeQuery(fileName)}' and '${escapeQuery(folderId)}' in parents and mimeType='${JSON_MIME}' and trashed=false`;
    const found = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1, includeItemsFromAllDrives: true, supportsAllDrives: true });
    const f = found.data.files?.[0];
    return f ? f.id : null;
  },
  async read(fileId) {
    const drive = getDrive();
    const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return JSON.parse(text);
  },
  // update(fileId 있으면) 또는 create. 새/기존 fileId 반환.
  async write(fileName, existingFileId, data) {
    const drive = getDrive();
    const body = JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2);
    if (existingFileId) {
      try {
        const updated = await drive.files.update({ fileId: existingFileId, media: { mimeType: JSON_MIME, body }, fields: "id" });
        return updated.data.id;
      } catch (e) {
        const code = e?.code || e?.response?.status;
        if (code !== 404) throw e; // 404(외부 삭제)만 새로 생성으로 폴백
      }
    }
    const folderId = await chatFolderId();
    const created = await drive.files.create({
      requestBody: { name: fileName, mimeType: JSON_MIME, parents: [folderId] },
      media: { mimeType: JSON_MIME, body },
      fields: "id"
    });
    return created.data.id;
  }
};

let io = driveIo;
export function __setIoForTest(fakeIo) { io = { ...driveIo, ...fakeIo }; }

// ── 방별 직렬화 큐 ─────────────────────────────────────────
export function withRoomLock(lockKey, fn) {
  const prev = queues.get(lockKey) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(lockKey, next.catch(() => {}));
  return next;
}

// ── 인덱스(목록/외부 변경 감지) ─────────────────────────────
async function refreshIndex(force) {
  if (!force && now() - _index.at < INDEX_TTL_MS) return _index;
  if (_indexPromise) return _indexPromise;
  _indexPromise = (async () => {
    const files = await io.listIndex();
    _index = { at: now(), files };
    // 외부 변경 감지: 캐시된 방이 Drive에서 더 최신이면(우리 쓰기가 아님) 캐시 무효화
    for (const [name, info] of files) {
      const entry = rooms.get(name);
      if (!entry) continue;
      const mt = new Date(info.modifiedTime).getTime() || 0;
      if (mt > (entry.localWriteAt || entry.loadedAt || 0) + 3000) rooms.delete(name);
    }
    return _index;
  })();
  try { return await _indexPromise; } finally { _indexPromise = null; }
}

async function findFileId(fileName) {
  const key = fileName.replace(/\.json$/, "");
  const idx = await refreshIndex(false);
  if (idx.files.has(key)) return idx.files.get(key).id;
  const id = await io.findByName(fileName);
  if (id) _index.files.set(key, { id, modifiedTime: new Date().toISOString() });
  return id;
}

// ── 방 데이터 ──────────────────────────────────────────────
// 캐시에 있으면 즉시(0콜). 없으면 Drive에서 로드. '파일 없음'은 null, 실제 오류는 throw
// (기존 chat-room의 "읽기 오류를 새 방으로 오인해 덮어쓰기 → 대화 소실" 방지 계약 유지).
// ★레이스 가드: 느린 Drive 읽기가 진행되는 사이 잠금 쓰기(persistRoom)가 캐시를 채웠다면
//   그쪽이 항상 더 최신이다 — 뒤늦게 도착한 옛 스냅샷으로 캐시를 덮어쓰면 다음 전송이
//   옛 데이터 기반으로 저장되어 방금 확정된 메시지가 유실된다. 로드 완료 후 재확인으로 차단.
//   동시 캐시 미스 폴링 N건은 in-flight promise 공유로 Drive read 1회로 합친다.
const loadPromises = new Map();
export async function loadRoom(roomId) {
  const cached = rooms.get(roomId);
  if (cached) return cached.data;
  let p = loadPromises.get(roomId);
  if (!p) {
    p = (async () => {
      const fileId = await findFileId(fileNameOf(roomId));
      if (!fileId) return null;
      const data = await io.read(fileId);
      const winner = rooms.get(roomId);
      if (winner) return winner.data;   // 로드 중 잠금 쓰기가 선점 → 그쪽이 최신
      rooms.set(roomId, { data, fileId, loadedAt: now(), localWriteAt: 0 });
      return data;
    })();
    const wrapped = p.then(
      (v) => { loadPromises.delete(roomId); return v; },
      (e) => { loadPromises.delete(roomId); throw e; }
    );
    loadPromises.set(roomId, wrapped);
    return wrapped;
  }
  return p;
}

// 잠금 안에서만 호출. 캐시 갱신 → Drive 쓰기. 실패 시 캐시 롤백 후 throw.
async function persistRoom(roomId, data) {
  const prev = rooms.get(roomId) || null;
  const fileId = prev?.fileId || await findFileId(fileNameOf(roomId));
  rooms.set(roomId, { data, fileId, loadedAt: now(), localWriteAt: now() });
  try {
    const newId = await io.write(fileNameOf(roomId), fileId, data);
    const entry = rooms.get(roomId);
    if (entry) { entry.fileId = newId; entry.localWriteAt = now(); }
    // 새로 만든 방이 인덱스 TTL 동안 목록(list)에 안 보이지 않도록 인덱스에도 즉시 반영
    _index.files.set(cleanName(roomId), { id: newId, modifiedTime: new Date().toISOString() });
    return data;
  } catch (e) {
    if (prev) rooms.set(roomId, prev); else rooms.delete(roomId);
    throw e;
  }
}

// 변경 함수(mutator)를 방 잠금 안에서 실행: 최신 데이터 로드 → mutator(cur) → 저장.
// mutator가 null/undefined 반환 시 저장하지 않는다. mutator의 throw는 그대로 전파.
export function mutateRoom(roomId, mutator) {
  return withRoomLock(roomId, async () => {
    let cur;
    try { cur = await loadRoom(roomId); }
    catch (e) { if (e && !e.stage) e.stage = "load"; throw e; }   // 읽기 오류(쿼터/네트워크) — 새 방으로 오인 금지
    const next = await mutator(cur);
    if (next == null) return cur;
    try { await persistRoom(roomId, next); }
    catch (e) { if (e && !e.stage) e.stage = "persist"; throw e; } // 쓰기 오류 — 캐시는 롤백됨
    return next;
  });
}

// 메시지 append 전용 — 저장 성공 후 이벤트 발행(롱폴 깨우기).
export async function appendMessage(roomId, buildData) {
  const data = await mutateRoom(roomId, buildData);
  const msgs = (data && data.messages) || [];
  const last = msgs[msgs.length - 1];
  chatEvents.emit("room:" + roomId, { roomId, lastMessageAt: last ? msgTime(last) : 0 });
  return data;
}

export function emitRoomChanged(roomId) {
  chatEvents.emit("room:" + roomId, { roomId, lastMessageAt: 0 });
}

// ── reads(읽음) — 메모리 즉시 + write-behind ────────────────
// loadRoom과 동일한 레이스 가드: 동시 콜은 in-flight 공유, 로드 완료 후 기존 엔트리가 있으면
// 그쪽 승리(늦게 온 옛 스냅샷이 markRead 직후 상태를 덮어쓰지 않게).
const metaPromises = new Map();
async function loadMeta(roomId) {
  const existing = metas.get(roomId);
  if (existing) return existing;
  let p = metaPromises.get(roomId);
  if (!p) {
    p = (async () => {
      // ★일시 오류(429/네트워크)를 reads={} 로 '영구' 캐시하면 안 된다 — 그 상태로 flush 되면
      //   그 방 다른 사용자들의 읽음 타임스탬프가 Drive 에서 통째로 지워진다. '파일 없음'과 '읽기 오류'를
      //   구분해, 오류일 땐 캐시하지 않는(ephemeral) 엔트리를 돌려주고 flush 를 막는다(다음 호출 재시도).
      let fileId = null;
      try { fileId = await findFileId(metaNameOf(roomId)); }
      catch (e) { return { reads: {}, fileId: null, loadedAt: now(), dirty: false, flushTimer: null, error: true }; }
      let reads = {};
      if (fileId) {
        try { const d = await io.read(fileId); reads = (d && d.reads) || {}; }
        catch (e) { return { reads: {}, fileId, loadedAt: now(), dirty: false, flushTimer: null, error: true }; }
      } else {
        // 레거시: 메시지 파일 내부 reads에서 1회 이관 (읽기 오류는 무시하고 빈 값으로 시작 — 파괴적 아님)
        const room = await loadRoom(roomId).catch(() => null);
        reads = (room && room.reads) || {};
      }
      const winner = metas.get(roomId);
      if (winner) return winner;
      const m = { reads, fileId, loadedAt: now(), dirty: false, flushTimer: null };
      metas.set(roomId, m);
      return m;
    })();
    const wrapped = p.then(
      (v) => { metaPromises.delete(roomId); return v; },
      (e) => { metaPromises.delete(roomId); throw e; }
    );
    metaPromises.set(roomId, wrapped);
    return wrapped;
  }
  return p;
}

function scheduleMetaFlush(roomId) {
  const m = metas.get(roomId);
  if (!m || m.flushTimer) return;
  m.flushTimer = setTimeout(() => {
    m.flushTimer = null;
    if (!m.dirty) return;
    m.dirty = false;
    withRoomLock(roomId + "__meta", async () => {
      try {
        // fileId 미상이면 write 전에 재해석 — 같은 이름의 __meta.json 중복 생성 방지
        if (!m.fileId) { try { m.fileId = await findFileId(metaNameOf(roomId)); } catch (e) {} }
        const newId = await io.write(metaNameOf(roomId), m.fileId, {
          type: "memberChatMeta", roomId, reads: m.reads, typing: {}, updatedAt: new Date().toISOString()
        });
        m.fileId = newId;
        _index.files.set(cleanName(roomId) + "__meta", { id: newId, modifiedTime: new Date().toISOString() });
      } catch (e) {
        m.dirty = true; // 다음 markRead 때 재시도
        console.error("[chat-store] meta flush 실패:", roomId, String(e?.message || e));
      }
    });
  }, META_FLUSH_MS);
  if (m.flushTimer && m.flushTimer.unref) m.flushTimer.unref();
}

export async function getReads(roomId) {
  const m = await loadMeta(roomId);
  return m.reads || {};
}

export async function markRead(roomId, userId) {
  const m = await loadMeta(roomId);
  m.reads[userId] = Math.max(Number(m.reads[userId]) || 0, now()); // 단조 증가
  if (m.error) return m.reads;   // 일시적 읽기 오류 상태 — 파괴적 flush 금지(다음 호출 때 재로드)
  m.dirty = true;
  scheduleMetaFlush(roomId);
  return m.reads;
}

// ── typing — 메모리 전용(Drive 쓰기 0) ─────────────────────
export function setTyping(roomId, userId, isTyping) {
  let t = typing.get(roomId);
  if (!t) { t = {}; typing.set(roomId, t); }
  if (isTyping) t[userId] = now();
  else delete t[userId];
}

export function getTyping(roomId) {
  const t = typing.get(roomId) || {};
  const cutoff = now() - TYPING_TTL_MS;
  for (const k of Object.keys(t)) { if (t[k] < cutoff) delete t[k]; }
  return t;
}

// ── 방 목록 — 인덱스 1콜 + 캐시된 방 데이터 ─────────────────
// 콜드 스타트에서만 방 파일들을 (동시 4개씩) 읽어 캐시를 데운다. 이후엔 Drive 0~1콜.
export async function listRoomSummaries() {
  const idx = await refreshIndex(false);
  const names = [...idx.files.keys()].filter((n) => !n.endsWith("__meta"));
  const missing = names.filter((n) => !rooms.has(n));
  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(missing.slice(i, i + CONCURRENCY).map((n) => loadRoom(n).catch(() => null)));
  }
  const out = [];
  for (const name of names) {
    const entry = rooms.get(name);
    if (entry && entry.data) out.push({ roomId: name, data: entry.data });
  }
  return out;
}

// 특정 사용자의 안읽음 수(메모리 계산).
export function countUnread(data, reads, userId) {
  if (!userId) return 0;
  const readAt = Number((reads || {})[userId]) || 0;
  let n = 0;
  for (const m of (data && data.messages) || []) {
    if (m.deleted) continue;
    if (String(m.userId || m.sender || "") === String(userId)) continue;
    if (msgTime(m) > readAt) n++;
  }
  return n;
}

// ── 롱폴 대기 — 이벤트 기반(대기 중 Drive 호출 0) ───────────
export async function waitForMessages(roomId, since, timeoutMs) {
  const pick = () => {
    const entry = rooms.get(roomId);
    const all = (entry && entry.data && Array.isArray(entry.data.messages)) ? entry.data.messages : null;
    if (!all) return null;
    const fresh = since > 0 ? all.filter((m) => msgTime(m) > since) : all.slice(-100);
    return { fresh, all };
  };
  await loadRoom(roomId).catch(() => null);
  let r = pick();
  if (r && r.fresh.length > 0) return r;
  return new Promise((resolve) => {
    const ev = "room:" + roomId;
    let timer = null;
    const onMsg = () => {
      const r2 = pick();
      if (r2 && r2.fresh.length > 0) { cleanup(); resolve(r2); }
    };
    const cleanup = () => { chatEvents.removeListener(ev, onMsg); if (timer) clearTimeout(timer); };
    chatEvents.on(ev, onMsg);
    timer = setTimeout(() => { cleanup(); resolve(pick() || { fresh: [], all: [] }); }, Math.max(1000, timeoutMs || 25000));
  });
}

// 테스트용: 내부 상태 초기화
export function __resetForTest() {
  for (const m of metas.values()) { if (m.flushTimer) clearTimeout(m.flushTimer); }
  rooms.clear(); metas.clear(); typing.clear(); queues.clear();
  loadPromises.clear(); metaPromises.clear();
  _folderId = null; _folderIdPromise = null; _index = { at: 0, files: new Map() }; _indexPromise = null;
  io = driveIo;
}
