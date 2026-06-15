import { getPool } from "../lib/db.js";

// Azure SQL 인덱스 테이블 전체 생성: chat_index, project_index, board_index, file_index
const DDL = `
IF OBJECT_ID('dbo.chat_index','U') IS NULL
CREATE TABLE dbo.chat_index(
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id NVARCHAR(100) NOT NULL,
  room_id NVARCHAR(100) NOT NULL,
  title NVARCHAR(255) NULL,
  project_id NVARCHAR(100) NULL,
  drive_file_id NVARCHAR(255) NULL,
  drive_link NVARCHAR(1000) NULL,
  message_count INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.project_index','U') IS NULL
CREATE TABLE dbo.project_index(
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id NVARCHAR(100) NOT NULL,
  project_id NVARCHAR(100) NOT NULL,
  title NVARCHAR(255) NULL,
  description NVARCHAR(1000) NULL,
  drive_folder_id NVARCHAR(255) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.board_index','U') IS NULL
CREATE TABLE dbo.board_index(
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id NVARCHAR(100) NOT NULL,
  post_id NVARCHAR(100) NOT NULL,
  category NVARCHAR(100) NULL,
  title NVARCHAR(255) NULL,
  writer NVARCHAR(100) NULL,
  drive_file_id NVARCHAR(255) NULL,
  drive_link NVARCHAR(1000) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.file_index','U') IS NULL
CREATE TABLE dbo.file_index(
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id NVARCHAR(100) NOT NULL,
  file_id NVARCHAR(100) NOT NULL,
  app NVARCHAR(50) NULL,
  category NVARCHAR(50) NULL,
  file_name NVARCHAR(255) NULL,
  mime_type NVARCHAR(120) NULL,
  drive_file_id NVARCHAR(255) NULL,
  drive_link NVARCHAR(1000) NULL,
  size_bytes BIGINT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.member_chat_index','U') IS NULL
CREATE TABLE dbo.member_chat_index(
  id INT IDENTITY(1,1) PRIMARY KEY,
  room_id NVARCHAR(100) NOT NULL,
  title NVARCHAR(255) NULL,
  members NVARCHAR(1000) NULL,
  last_message NVARCHAR(1000) NULL,
  drive_file_id NVARCHAR(255) NULL,
  drive_link NVARCHAR(1000) NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
`;

export default async function handler(req, res) {
  try {
    const pool = await getPool();
    await pool.request().query(DDL);
    const check = await pool.request().query(`
      SELECT name FROM sys.tables
      WHERE name IN ('users','chat_index','project_index','board_index','file_index','member_chat_index')
      ORDER BY name`);
    return res.status(200).json({
      ok: true,
      message: "Azure SQL 인덱스 테이블 생성/확인 완료",
      tables: check.recordset.map((r) => r.name)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "인덱스 테이블 생성 실패", error: e.message, code: e.code || null });
  }
}
