// lib/zipbuild.js — ZIP 생성 공용 순수 헬퍼 (압축 파일명 정리 / 타임스탬프 / zip 내부 경로 중복 회피).
// 의존성 0. Node·브라우저 공용. drive-manage.js(zip action)에서 사용, test/zip-build.test.js로 검증.

// 윈도/파일시스템에서 금지된 문자 9종. (공백·하이픈·한글 등은 보존)
const ILLEGAL = /[\\/:*?"<>|]/g;
// 제어문자 (0x00-0x1F) 별도 제거.
const CONTROL = /[\x00-\x1f]/g;

// 사용자가 준 이름(확장자 유무 무관)을 안전한 "<name>.zip"로 정리.
// 빈 값이면 ""을 반환 → 호출측에서 timestampName() 으로 폴백.
export function sanitizeZipName(name) {
  let s = String(name == null ? "" : name).trim();
  if (!s) return "";
  s = s.replace(/\.zip$/i, "");                // 기존 .zip 떼고 본문만 정리
  s = s.replace(CONTROL, "").replace(ILLEGAL, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!s) return "";
  return s + ".zip";
}

// 기본 압축 파일명 (선택 항목이 2개 이상이거나 이름 미지정 시): 압축_YYYYMMDD_HHMM.zip
export function timestampName(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `압축_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

// zip 내부 경로가 겹칠 때 " (n)" 접미사로 회피 (used 는 Set). 디렉터리/확장자 보존.
export function dedupeZipPath(path, used) {
  let p = String(path == null ? "file" : path) || "file";
  if (!used.has(p)) { used.add(p); return p; }
  const slash = p.lastIndexOf("/");
  const dir = slash >= 0 ? p.slice(0, slash + 1) : "";
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let i = 1, cand;
  do { cand = `${dir}${stem} (${i})${ext}`; i++; } while (used.has(cand));
  used.add(cand);
  return cand;
}

export default { sanitizeZipName, timestampName, dedupeZipPath };
