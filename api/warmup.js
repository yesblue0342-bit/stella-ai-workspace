// Stella warm-up 엔드포인트 — Azure SQL 서버리스 콜드 스타트 선제 예열용.
// 앱 로드 직후 클라이언트가 호출하여 SELECT 1 으로 풀/DB 를 깨운다(재시도 3회 내장).
// 실패해도 200 으로 응답(앱 흐름 차단 금지). 채팅/노트 목록 로딩 전에 예열되어
// 콜드 스타트로 인한 "목록이 간헐적으로 안 뜨는" 문제를 완화한다.
import { warmup } from "../lib/db.js";
export default async function handler(req, res) {
  const startedAt = Date.now();
  let warmed = false;
  try {
    warmed = await warmup();
  } catch (_) {
    warmed = false;
  }
  // 캐시 금지 (항상 실시간 예열)
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    warmed,
    elapsed_ms: Date.now() - startedAt
  });
}
