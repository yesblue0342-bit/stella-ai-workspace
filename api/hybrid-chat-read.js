import { readJsonById, readJsonFromDrive } from "../lib/drive-utils.js";
import { requireOwner } from "../lib/session.js";

// 단일 채팅의 전체 메시지를 Drive 백업(chatgpt/chats/{userId}/{roomId}.json)에서 읽어온다.
// hybrid-chat-list 는 SQL 인덱스(메시지 없음)만 주므로, 복원된 채팅을 "열 때" 이 엔드포인트로
// 메시지를 지연 로드한다 → 목록 조회는 가볍게(1 SQL), 내용은 필요할 때만(1 Drive) 가져온다.
function clean(v) { return String(v || "").trim(); }
function safeId(v, p = "id") { return (clean(v) || `${p}_0`).replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 100); }

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const requested = clean(req.query?.userId || req.query?.owner || req.query?.email);
    // 서버측 권한 스코프: 인증 uid 의 채팅만 읽는다(타인 채팅 접근 차단).
    const auth = requireOwner(req, res, requested);
    if (!auth) return; // 401/403 이미 응답됨
    const userId = auth.uid;
    const roomId = safeId(req.query?.roomId || req.query?.id, "room");
    const fileId = clean(req.query?.fileId || req.query?.driveFileId);

    let data = null;
    // 1) 파일 ID 우선(경로 재해석 없이 1콜). chat_index.drive_file_id 재사용.
    if (fileId) { try { data = await readJsonById(fileId); } catch (e) {} }
    // 2) 폴백: 경로+파일명으로 조회
    if (!data) {
      try {
        const hit = await readJsonFromDrive({ folderPath: ["chatgpt", "chats", safeId(userId, "user")], fileName: `${roomId}.json` });
        data = hit && hit.data;
      } catch (e) {}
    }
    if (!data) return res.status(200).json({ ok: true, found: false, roomId, messages: [] });

    const messages = Array.isArray(data.messages) ? data.messages : [];
    return res.status(200).json({ ok: true, found: true, roomId, title: clean(data.title), projectId: clean(data.projectId), messages });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "채팅 읽기 실패", error: e.message, messages: [] });
  }
}
