/*
 * 방 멤버십/나가기 로직 (PART C3) — 순수 함수, 서버(api/chat-room)와 테스트 공용.
 *
 * "방 나가기"는 물리 삭제가 아니라 멤버에서 제외 + left 기록(영구 반영)이다.
 * 멤버가 모두 나가면 방을 soft-delete(tombstone). 이렇게 해야 재동기화로 방이
 * 되살아나거나 다른 멤버의 방까지 사라지지 않는다.
 */

// 방 데이터에서 userId를 나가게 한 새 데이터 반환 (원본 불변)
export function applyLeave(data, userId) {
  const d = Object.assign({}, data || {});
  const uid = String(userId || "");
  const members = (Array.isArray(d.members) ? d.members : []).map(String).filter(m => m && m !== uid);
  const left = Array.from(new Set([...(Array.isArray(d.left) ? d.left : []).map(String), uid].filter(Boolean)));
  d.members = members;
  d.left = left;
  d.updatedAt = new Date().toISOString();
  if (members.length === 0) {            // 아무도 안 남으면 방 자체를 tombstone
    d.deleted = true;
    d.deletedAt = new Date().toISOString();
  }
  return d;
}

// 목록(action=list)에 이 방을 userId에게 보여줄지 여부
export function shouldListRoom(data, userId) {
  if (!data) return false;
  if (data.deleted) return false;                          // soft-deleted 방 제외
  const uid = String(userId || "");
  if (!uid) return true;                                   // userId 없으면 전체
  const members = Array.isArray(data.members) ? data.members.map(String) : [];
  if (members.length && !members.includes(uid)) return false; // 멤버 아니면 제외(나간 사람 포함)
  const left = Array.isArray(data.left) ? data.left.map(String) : [];
  if (left.includes(uid)) return false;                    // 나간 기록 있으면 제외
  return true;
}
