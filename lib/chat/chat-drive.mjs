// lib/chat/chat-drive.mjs — Stella GPT 채팅 내역의 Drive 저장 위치 규칙 + 레거시 이전(마이그레이션).
//
// 배경: 채팅 내역이 StellaGPT/chatgpt/chats/{uid}/{roomId}.json 에 저장돼 있었으나,
//   사용자 요구는 StellaGPT/users/{uid}/chats/ (프로필/설정과 같은 유저 폴더 하위).
//   member-store.js 가 가입 시 users/{safe(id)}/profile·settings 를 만드는 구조와 일관되게 맞춘다.
//
// 규칙:
//   · 신규 저장/조회: users/{safeUser(uid)}/chats/{safeRoom(roomId)}.json
//   · 레거시 조회 폴백: chatgpt/chats/{legacyUser(uid)}/{safeRoom(roomId)}.json
//   · 중복 방지: 신규 위치에 저장하면 레거시 동일 roomId 파일은 휴지통 이동.
//   · 이전(migrate): 레거시 파일을 re-parent(부모 폴더만 이동)한다 → fileId 불변 →
//     chat_index.drive_file_id 그대로 유효, 재조회/삭제 경로 무영향, 물리적 중복 0.
//
// 순수 오케스트레이션(migrateChatsWithOps)은 ops 를 주입받아 Drive 없이 단위 테스트한다.

// member-store.js 의 safe() 와 동일 규칙 — chats 가 프로필 폴더와 같은 users/{id} 에 들어가도록.
export function safeUser(v) {
  return String(v || "").trim().toLowerCase().replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 120) || "user";
}
// hybrid-chat-save.js 가 파일명으로 쓰던 규칙(safeId)과 동일 — 기존 파일명/SQL room_id 와 정렬.
export function safeRoom(v, p = "room") {
  return (String(v || "").trim() || `${p}_0`).replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 100);
}
// 레거시(chatgpt/chats) 폴더가 기록될 때 쓰인 safeId 규칙(대소문자 보존, 가-힣 허용).
export function legacyUser(v) {
  return (String(v || "").trim() || "user").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 100);
}

export const userChatsPath = (uid) => ["users", safeUser(uid), "chats"];
export const legacyChatsPath = (uid) => ["chatgpt", "chats", legacyUser(uid)];
export const chatFileName = (roomId) => `${safeRoom(roomId)}.json`;

// ── 순수 이전 로직 ─────────────────────────────────────────────
// ops 계약:
//   legacyRoot(): {id} | null                       chatgpt/chats 폴더(없으면 null)
//   listUserFolders(parentId): [{id,name}]           그 아래 유저 폴더들
//   listJsonFiles(folderId): [{id,name}]             유저 폴더 안 *.json
//   ensureDest(userFolderName): {id}                 users/{name}/chats (없으면 생성)
//   findByName(destId,name): {id} | null             목적지에 같은 이름 파일 존재 여부
//   reparent(fileId,fromId,toId): void               부모만 이동(fileId 불변)
//   trash(fileId): void                              레거시 중복본 휴지통
export async function migrateChatsWithOps(ops, { dryRun = false, log = () => {} } = {}) {
  const result = { ok: true, moved: 0, deduped: 0, skipped: 0, errors: 0, users: 0, dryRun };
  const legacy = await ops.legacyRoot();
  if (!legacy) { result.reason = "no-legacy-folder"; return result; }
  const userFolders = await ops.listUserFolders(legacy.id);
  for (const uf of userFolders) {
    result.users++;
    let destId;
    try { destId = (await ops.ensureDest(uf.name)).id; }
    catch (e) { result.errors++; log(`ensureDest 실패 ${uf.name}: ${e.message}`); continue; }
    const files = await ops.listJsonFiles(uf.id);
    for (const f of files) {
      try {
        const existing = await ops.findByName(destId, f.name);
        if (existing && existing.id === f.id) { result.skipped++; continue; } // 이미 이전됨
        if (existing && existing.id !== f.id) {
          // 신규 위치에 이미 별도 최신본 존재 → 레거시 중복 파일 휴지통(중복 저장 방지)
          if (!dryRun) await ops.trash(f.id);
          result.deduped++; continue;
        }
        if (!dryRun) await ops.reparent(f.id, uf.id, destId);
        result.moved++;
      } catch (e) { result.errors++; log(`이전 실패 ${uf.name}/${f.name}: ${e.message}`); }
    }
  }
  return result;
}

// ── 실제 Drive ops (스크립트/서버 부팅용) ─────────────────────
const FOLDER_MIME = "application/vnd.google-apps.folder";
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function realDriveOps() {
  const m = await import("../drive-utils.js");
  const drive = m.getDrive();
  const list = async (q, fields) => {
    const r = await drive.files.list({ q, fields, pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true });
    return r.data.files || [];
  };
  return {
    async legacyRoot() { return await m.resolvePathIfExists(["chatgpt", "chats"]); },
    async listUserFolders(pid) {
      return await list(`mimeType='${FOLDER_MIME}' and '${esc(pid)}' in parents and trashed=false`, "files(id,name)");
    },
    async listJsonFiles(pid) {
      const files = await list(`'${esc(pid)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`, "files(id,name)");
      return files.filter((f) => /\.json$/i.test(f.name));
    },
    async ensureDest(userFolderName) { return await m.ensurePath(["users", userFolderName, "chats"]); },
    async findByName(pid, name) {
      const files = await list(`name='${esc(name)}' and '${esc(pid)}' in parents and trashed=false`, "files(id,name)");
      return files[0] || null;
    },
    async reparent(fileId, fromId, toId) {
      await drive.files.update({ fileId, addParents: toId, removeParents: fromId, fields: "id,parents", supportsAllDrives: true });
    },
    async trash(fileId) {
      await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
    },
  };
}

export async function migrateChatsToUsers(opts = {}) {
  const ops = opts.ops || (await realDriveOps());
  return migrateChatsWithOps(ops, opts);
}

// 신규 위치 저장 후, 레거시 chatgpt/chats/{uid}/{roomId}.json 중복본을 휴지통으로(중복 방지).
// 베스트에포트 — 실패해도 저장 자체는 성공으로 유지한다.
export async function trashLegacyChat(uid, roomId) {
  try {
    const m = await import("../drive-utils.js");
    const hit = await m.resolvePathIfExists(legacyChatsPath(uid));
    if (!hit) return false;
    const drive = m.getDrive();
    const name = chatFileName(roomId);
    const r = await drive.files.list({
      q: `name='${esc(name)}' and '${esc(hit.id)}' in parents and trashed=false`,
      fields: "files(id)", pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const f = (r.data.files || [])[0];
    if (!f) return false;
    await drive.files.update({ fileId: f.id, requestBody: { trashed: true }, supportsAllDrives: true });
    return true;
  } catch (e) { return false; }
}
