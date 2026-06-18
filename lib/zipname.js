// lib/zipname.js — ZIP filename Korean (CP949/EUC-KR) mojibake fix. No deps. Browser/Node 공용.
// 원인: 한국 Windows zip은 파일명을 CP949로 저장(UTF-8 플래그 없음). UTF-8/Latin1로
// 디코딩하면 깨짐. TextDecoder('euc-kr')만으로 복구한다.

const __HANGUL = /[가-힣㄰-㆏]/;
const __HIGH_LATIN1 = /[\x80-\xFF]/;

function makeDecoder(label) {
  // Node 18+ / modern browsers have TextDecoder built-in. Safe fallback if euc-kr unsupported.
  try { return new TextDecoder(label); } catch (_) { return null; }
}

// (A) primary: raw filename bytes + UTF-8 flag
export function decodeZipName(rawBytes, isUtf8Flag) {
  const u8 = rawBytes instanceof Uint8Array ? rawBytes : Uint8Array.from(rawBytes);
  if (isUtf8Flag) return new TextDecoder("utf-8").decode(u8);
  try {
    const asUtf8 = new TextDecoder("utf-8", { fatal: true }).decode(u8);
    if (__HANGUL.test(asUtf8) || !__HIGH_LATIN1.test(asUtf8)) return asUtf8;
  } catch (_) { /* not valid UTF-8 -> try CP949 */ }
  const dec = makeDecoder("euc-kr");
  return dec ? dec.decode(u8) : new TextDecoder("utf-8").decode(u8);
}

// (B) fallback: repair an already-mojibaked string (leaves valid UTF-8 Hangul untouched)
export function repairMojibakeName(name) {
  const s = String(name || "");
  if (__HANGUL.test(s)) return s;          // already valid Hangul
  if (!__HIGH_LATIN1.test(s)) return s;    // pure ASCII
  const bytes = Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
  const dec = makeDecoder("euc-kr");
  if (!dec) return s;
  const fixed = dec.decode(bytes);
  return __HANGUL.test(fixed) ? fixed : s; // accept only if recovery yields Hangul
}

export function repairMojibakePath(path) {
  return String(path || "").split("/").map(repairMojibakeName).join("/");
}

export default { decodeZipName, repairMojibakeName, repairMojibakePath };
