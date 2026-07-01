import { getPool, sql, withRetry } from "../lib/db.js";
import { requireOwner } from "../lib/session.js";
import { shouldSkipEmptyOverwrite } from "../lib/workspace-guard.js";

function clean(value) {
  return String(value || "").trim();
}

async function ensureWorkspaceTables(pool) {
  await pool.request().query(`
IF OBJECT_ID('dbo.workspace_state', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.workspace_state (
    owner_id NVARCHAR(255) NOT NULL PRIMARY KEY,
    rooms_json NVARCHAR(MAX) NULL,
    projects_json NVARCHAR(MAX) NULL,
    posts_json NVARCHAR(MAX) NULL,
    member_json NVARCHAR(MAX) NULL,
    drive_index_json NVARCHAR(MAX) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
IF COL_LENGTH('dbo.workspace_state', 'rooms_json') IS NULL ALTER TABLE dbo.workspace_state ADD rooms_json NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.workspace_state', 'projects_json') IS NULL ALTER TABLE dbo.workspace_state ADD projects_json NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.workspace_state', 'posts_json') IS NULL ALTER TABLE dbo.workspace_state ADD posts_json NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.workspace_state', 'member_json') IS NULL ALTER TABLE dbo.workspace_state ADD member_json NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.workspace_state', 'drive_index_json') IS NULL ALTER TABLE dbo.workspace_state ADD drive_index_json NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.workspace_state', 'updated_at') IS NULL ALTER TABLE dbo.workspace_state ADD updated_at DATETIME2 NOT NULL CONSTRAINT DF_workspace_state_updated_at DEFAULT SYSUTCDATETIME();
  `);
}

function safeJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toJson(value) {
  return JSON.stringify(value ?? []);
}

export default async function handler(req, res) {
  try {
    const requested = clean(req.query?.owner || req.body?.owner || req.body?.owner_id || req.body?.userId || req.body?.user_id);
    // 서버측 권한 스코프: 인증된 토큰의 uid 로만 접근. 미인증=401, 타인 데이터 요청=403.
    const auth = requireOwner(req, res, requested);
    if (!auth) return; // 401/403 이미 응답됨
    const ownerId = auth.uid;
    if (!ownerId) return res.status(400).json({ ok: false, message: "owner/userId가 필요합니다." });

    const pool = await getPool();
    await ensureWorkspaceTables(pool);

    if (req.method === "GET") {
      // 콜드 스타트 대응: 읽기 쿼리는 멱등하므로 3회까지 재시도.
      const result = await withRetry(() => pool.request()
        .input("owner_id", sql.NVarChar(255), ownerId)
        .query(`SELECT TOP 1 owner_id, rooms_json, projects_json, posts_json, member_json, drive_index_json, updated_at FROM dbo.workspace_state WHERE owner_id = @owner_id`),
        { retries: 3, baseDelay: 400 });
      const row = result.recordset[0];
      return res.status(200).json({
        ok: true,
        owner: ownerId,
        rooms: safeJson(row?.rooms_json, []),
        projects: safeJson(row?.projects_json, []),
        posts: safeJson(row?.posts_json, []),
        member: safeJson(row?.member_json, []),
        driveIndex: safeJson(row?.drive_index_json, []),
        updated_at: row?.updated_at || null
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = req.body || {};
      const roomsJson = toJson(body.rooms);
      const projectsJson = toJson(body.projects);
      const postsJson = toJson(body.posts);

      // ★ 방어(서버측): 채팅/프로젝트/노트가 모두 빈 저장 요청이면, 기존에 비어있지 않은
      //   데이터를 덮어쓰지 않는다. 신규/새 환경 기기가 초기 읽기 실패 후 빈 상태를 밀어넣어
      //   계정 전체 데이터를 파괴하던 사고를 이중으로 차단. (force=1 또는 allowEmpty=true 시 허용)
      const forced = body.allowEmpty === true || String(req.query?.force || "") === "1";
      const incoming = { rooms: roomsJson, projects: projectsJson, posts: postsJson };
      const isEmpty = (v) => v == null || v === "" || v === "[]" || v === "null" || v === "{}";
      if (isEmpty(roomsJson) && isEmpty(projectsJson) && isEmpty(postsJson) && !forced) {
        const cur = await pool.request()
          .input("owner_id", sql.NVarChar(255), ownerId)
          .query(`SELECT TOP 1 rooms_json, projects_json, posts_json FROM dbo.workspace_state WHERE owner_id = @owner_id`);
        if (shouldSkipEmptyOverwrite(incoming, cur.recordset[0], forced)) {
          return res.status(200).json({ ok: true, skipped: true, owner: ownerId, message: "빈 상태 덮어쓰기 차단(기존 데이터 보존)" });
        }
      }

      await pool.request()
        .input("owner_id", sql.NVarChar(255), ownerId)
        .input("rooms_json", sql.NVarChar(sql.MAX), roomsJson)
        .input("projects_json", sql.NVarChar(sql.MAX), projectsJson)
        .input("posts_json", sql.NVarChar(sql.MAX), postsJson)
        .input("member_json", sql.NVarChar(sql.MAX), toJson(body.member))
        .input("drive_index_json", sql.NVarChar(sql.MAX), toJson(body.driveIndex || body.drive_index))
        .query(`
MERGE dbo.workspace_state AS target
USING (SELECT @owner_id AS owner_id) AS source
ON target.owner_id = source.owner_id
WHEN MATCHED THEN UPDATE SET
  rooms_json = @rooms_json,
  projects_json = @projects_json,
  posts_json = @posts_json,
  member_json = @member_json,
  drive_index_json = @drive_index_json,
  updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (owner_id, rooms_json, projects_json, posts_json, member_json, drive_index_json)
VALUES (@owner_id, @rooms_json, @projects_json, @posts_json, @member_json, @drive_index_json);
        `);
      return res.status(200).json({ ok: true, message: "작업공간 저장 완료", owner: ownerId });
    }

    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "작업공간 저장/조회 실패", error: error.message, code: error.code || null });
  }
}
