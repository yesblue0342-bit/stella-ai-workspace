import { getPool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = await getPool();

    await pool.request().query(`
      IF OBJECT_ID('dbo.chat_messages', 'U') IS NOT NULL
        DROP TABLE dbo.chat_messages;

      IF OBJECT_ID('dbo.users', 'U') IS NOT NULL
        DROP TABLE dbo.users;

      CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        email NVARCHAR(255) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        name NVARCHAR(100) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );

      CREATE TABLE dbo.chat_messages (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NULL,
        role NVARCHAR(20) NOT NULL,
        content NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_chat_messages_users
          FOREIGN KEY (user_id) REFERENCES dbo.users(id)
      );
    `);

    return res.status(200).json({
      message: "DB 테이블 생성 성공",
      tables: ["users", "chat_messages"]
    });
  } catch (error) {
    return res.status(500).json({
      message: "DB 테이블 생성 실패",
      error: error.message
    });
  }
}
