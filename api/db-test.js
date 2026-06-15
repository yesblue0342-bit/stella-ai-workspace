import { getPool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = await getPool();

    const result = await pool.request().query("SELECT 1 AS ok");

    return res.status(200).json({
      message: "DB 연결 성공",
      result: result.recordset
    });
  } catch (err) {
    return res.status(500).json({
      message: "DB 연결 실패",
      error: err.message
    });
  }
}
