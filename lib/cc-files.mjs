// lib/cc-files.mjs — 세션 이벤트에서 에이전트가 생성/수정한 파일을 복원 (PART B 폴백)
// Managed Agents 파일 직접 조회 API가 없을 때, 정규화된 이벤트의 write/create tool_use를
// 스캔해 {path, content} 목록을 만든다. 같은 경로는 마지막(최신) write가 이긴다.

const WRITE_TOOLS = new Set(["write", "create", "create_file", "write_file", "str_replace_editor"]);

function pickPath(input) {
  if (!input || typeof input !== "object") return null;
  return input.path || input.file_path || input.filename || input.file || input.target_file || null;
}
function pickContent(input) {
  if (!input || typeof input !== "object") return null;
  // str_replace_editor의 create 명령은 file_text 사용
  if (input.content != null) return String(input.content);
  if (input.file_text != null) return String(input.file_text);
  if (input.text != null && (input.command === "create" || input.command == null)) return String(input.text);
  return null;
}

// events: normalizeEvents 결과 [{seq,kind,name,input,...}]
export function extractFilesFromEvents(events) {
  const byPath = new Map();
  for (const ev of (events || [])) {
    if (!ev || ev.kind !== "tool_use") continue;
    const name = String(ev.name || "").toLowerCase();
    const isWrite = WRITE_TOOLS.has(name) || /(^|_)write|create/.test(name);
    if (!isWrite) continue;
    const p = pickPath(ev.input);
    const c = pickContent(ev.input);
    if (!p || c == null) continue;
    byPath.set(sanitizeRelPath(p), c); // 최신 write가 이김(append-only seq 순서)
  }
  return Array.from(byPath.entries()).map(([path, content]) => ({ path, content }));
}

// 경로 정리: 선행 슬래시·.. 제거, 안전한 상대 경로만 유지
export function sanitizeRelPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^[/.]+/, "")                       // 선행 / 또는 ./ ../
    .split("/").filter(seg => seg && seg !== "." && seg !== "..")
    .join("/")
    .replace(/[\x00-\x1f]/g, "")
    .slice(0, 200) || "file";
}

export default { extractFilesFromEvents, sanitizeRelPath };
