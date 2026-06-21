// lib/exporters.mjs — 표 매트릭스 → TSV/CSV/AOA + 파일명. 순수 함수(테스트 가능).
export function matrixToTSV(matrix = []) {
  return matrix.map((row) => row.map((c) => String(c ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t")).join("\n");
}
export function matrixToCSV(matrix = []) {
  const esc = (c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return matrix.map((row) => row.map(esc).join(",")).join("\n");
}
export function matrixToAOA(matrix = []) { return matrix.map((row) => row.map((c) => String(c ?? ""))); }
export function exportFilename(ext = "xlsx", date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return `stella_표_${y}${m}${d}.${ext}`;
}
