// lib/workspace-guard.js — 워크스페이스 저장 방어 로직(순수 함수, DB 무의존).
//
// 목적: 신규/새 환경 기기가 초기 읽기 실패 후 "빈 상태"를 서버에 저장하여
//       계정 전체 데이터(채팅/프로젝트/노트)를 파괴하던 사고를 서버측에서 이중 차단.
//
// 규칙: 들어온 rooms/projects/posts 가 모두 비어 있고(force 아님), 기존 행에 데이터가
//       하나라도 있으면 저장을 건너뛴다(기존 데이터 보존). 부분 삭제(일부만 빔)는 허용.

// NVARCHAR(MAX) JSON 문자열(또는 값)이 "비어있음"인지 판정.
export function isEmptyJson(v) {
  return v == null || v === "" || v === "[]" || v === "null" || v === "{}";
}

// 저장을 건너뛰어야 하는가?
//   incoming: { rooms, projects, posts } — toJson() 으로 직렬화된 문자열
//   existingRow: DB의 기존 행({rooms_json, projects_json, posts_json}) 또는 null
//   forced: allowEmpty/force=1 이면 방어 해제
export function shouldSkipEmptyOverwrite(incoming, existingRow, forced) {
  if (forced) return false;
  const incomingAllEmpty =
    isEmptyJson(incoming.rooms) && isEmptyJson(incoming.projects) && isEmptyJson(incoming.posts);
  if (!incomingAllEmpty) return false;
  if (!existingRow) return false;
  const existingHasData =
    !isEmptyJson(existingRow.rooms_json) ||
    !isEmptyJson(existingRow.projects_json) ||
    !isEmptyJson(existingRow.posts_json);
  return existingHasData;
}

export default { isEmptyJson, shouldSkipEmptyOverwrite };
