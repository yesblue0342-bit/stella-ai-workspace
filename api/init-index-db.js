import { getPool } from "../lib/db.js";

export default async function handler(req,res){
 try{
  const pool=await getPool();
  await pool.request().query(`
IF OBJECT_ID('dbo.users','U') IS NULL
BEGIN
 CREATE TABLE dbo.users(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NULL,email NVARCHAR(255) NULL,password_hash NVARCHAR(255) NULL,name NVARCHAR(100) NULL,birth NVARCHAR(30) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NULL);
END;
IF OBJECT_ID('dbo.chat_index','U') IS NULL
BEGIN
 CREATE TABLE dbo.chat_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,room_id NVARCHAR(100) NOT NULL,title NVARCHAR(255) NULL,project_id NVARCHAR(100) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,message_count INT NOT NULL DEFAULT 0,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
END;
IF OBJECT_ID('dbo.project_index','U') IS NULL
BEGIN
 CREATE TABLE dbo.project_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,project_id NVARCHAR(100) NOT NULL,name NVARCHAR(255) NOT NULL,drive_folder_id NVARCHAR(255) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
END;
IF OBJECT_ID('dbo.board_index','U') IS NULL
BEGIN
 CREATE TABLE dbo.board_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,post_id NVARCHAR(100) NOT NULL,category NVARCHAR(255) NULL,title NVARCHAR(255) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
END;
IF OBJECT_ID('dbo.file_index','U') IS NULL
BEGIN
 CREATE TABLE dbo.file_index(id INT IDENTITY(1,1) PRIMARY KEY,user_id NVARCHAR(100) NOT NULL,file_id NVARCHAR(100) NOT NULL,file_name NVARCHAR(255) NULL,mime_type NVARCHAR(255) NULL,drive_file_id NVARCHAR(255) NULL,drive_link NVARCHAR(1000) NULL,room_id NVARCHAR(100) NULL,post_id NVARCHAR(100) NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
END;
`);
  return res.status(200).json({ok:true,message:"Azure SQL index tables ready",tables:["users","chat_index","project_index","board_index","file_index"]});
 }catch(e){return res.status(500).json({ok:false,message:"index table init failed",error:e.message});}
}
