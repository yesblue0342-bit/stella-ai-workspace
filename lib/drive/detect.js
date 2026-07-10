// lib/drive/detect.js — 사용자 문장에서 Drive 경로·링크·검색 키워드를 뽑는 순수 함수.
// lib/drive-utils.js 분리의 일부. 네트워크/환경변수 의존 0 → node --test 로 전 분기 검증 가능.

/** 경로 조각 끝의 명령성 꼬리말("… 분석해줘")을 제거한다. 공백 경계에서만 → 폴더명 일부 보존. */
export function cleanupPathPart(part = "") {
  return String(part || "")
    .replace(/\s+(?:(?:파일들|파일|폴더|자료|내용|목록|리스트)\s*)?(?:을|를|의|안의|에서|에)?\s*(?:리뷰|분석|요약|정리|확인|검색|찾아|보여|열어|읽어|알려)(?:\s*(?:해줘|해주세요|주세요|줘|해|바랍니다))?\.?$/i, "")
    .replace(/\s*(?:찾아줘|찾아주세요|보여줘|알려줘|열어줘|읽어줘|정리해줘|분석해줘|요약해줘)\.?$/i, "")
    .trim();
}

/**
 * 큰 파일 텍스트를 질의 관련 부분 위주로 발췌(토큰 초과 방지). 추가 LLM 호출 없음.
 * 키워드가 있으면 머리말 + 키워드 포함 단락, 없으면(요약요청 등) 머리말 + 본문 앞부분.
 * @returns {{text: string, truncated: boolean}}
 */
export function condenseForQuery(text, terms, maxChars) {
  text = String(text || "");
  if (text.length <= maxChars) return { text, truncated: false };
  const lowTerms = (terms || []).map((t) => String(t).toLowerCase()).filter((t) => t.length >= 2);
  const headBudget = Math.min(8000, Math.floor(maxChars * 0.25));
  let out = text.slice(0, headBudget);
  const rest = text.slice(headBudget);
  if (lowTerms.length) {
    for (const p of rest.split(/\n{2,}/)) {
      if (out.length + p.length + 2 > maxChars) continue;
      if (lowTerms.some((t) => p.toLowerCase().includes(t))) out += "\n\n" + p;
    }
  }
  if (out.length < maxChars && rest.length) out += "\n\n" + rest.slice(0, maxChars - out.length);
  return { text: out.slice(0, maxChars), truncated: true };
}

// '#구글드라이브폴더 A/B' 처럼 붙는 명령 키워드 — 폴더명으로 오인하면 안 된다.
const DRIVE_COMMAND_PREFIX =
  /^(구글\s*드라이브\s*폴더|구글\s*드라이브|구글드라이브폴더|구글드라이브|구드라이브|구드|google\s*drive\s*folder|google\s*drive|gdrive|드라이브\s*폴더|드라이브|my\s*drive|mydrive)\s*/i;

/**
 * 문장에서 Drive 폴더 경로를 "A > B" 형태로 뽑는다. 못 찾으면 빈 문자열.
 * ① '#폴더명' 명령 규약  ② 자연어 "<이름> 폴더 하위의 <이름> 폴더"  ③ "내 드라이브 > A > B"
 */
export function detectDrivePathText(message = "") {
  const raw = String(message || "");

  // ★ # 으로 시작하는 입력을 폴더/파일 경로로 인식 (#폴더명 또는 #폴더 > 하위)
  const hashLine = raw.split(/\r?\n/).find((l) => l.trim().startsWith("#"));
  if (hashLine) {
    // 명령 키워드(구글드라이브폴더/드라이브 등)를 폴더명으로 오인하지 않도록 먼저 제거
    // 예: "#구글드라이브폴더 3디와이/SAP 분석해줘" → "3디와이/SAP" 만 경로/키워드로 사용
    const afterHash = hashLine.trim().replace(/^#+\s*/, "").trim().replace(DRIVE_COMMAND_PREFIX, "").trim();
    if (afterHash) {
      // 자연어 지시어가 붙어있으면 폴더명만 추출 (조사·동사 전까지, 공백 경계 기준)
      const folderName = afterHash.split(/\s+(?:파일|리스트|목록|자료|내용|읽고|읽어|분석|요약|정리|확인|검색|찾아|찾아줘|보여|열어|알려|을|를|에서|폴더의|안의|에)(?=\s|$)/)[0].trim();
      // 경로 구분자: '>' 또는 '/' 둘 다 허용
      const parts = (folderName || afterHash).split(/[>/]/).map(cleanupPathPart).filter(Boolean);
      if (parts.length) return parts.join(" > ");
    }
  }

  // ★ 자연어 중첩 폴더 경로 인식: "구글 드라이브 폴더 내 A 폴더 하위의 B 폴더 …"처럼 물으면
  //   경로를 인식 못해 buildDriveContextForChat이 null을 반환 → "정확한 폴더명으로 다시
  //   시도하라"는 안내만 반복하던 고질 버그. "<이름> 폴더" 토큰을 등장 순서대로 이어붙인다.
  //   Drive 신호와 "폴더"가 함께 있을 때만 시도해 일반 대화와의 오탐을 막는다.
  if (/드라이브|\b(?:my|google)\s*drive\b|\bgdrive\b/i.test(raw) && /폴더/.test(raw)) {
    const DRIVE_KEYWORD = /^(구글\s*드라이브|드라이브|google\s*drive|my\s*drive|mydrive|gdrive)$/i;
    const segRe = /([\p{L}\p{N}_.-]+)\s*폴더/gu;
    const segs = [];
    let mm;
    while ((mm = segRe.exec(raw)) !== null) {
      const token = cleanupPathPart(mm[1].trim());
      if (!token || DRIVE_KEYWORD.test(token)) continue; // "구글 드라이브 폴더"의 '드라이브' 자체는 경로가 아님
      segs.push(token);
    }
    if (segs.length) return segs.join(" > ");
  }

  if (!raw.includes("내 드라이브") && !raw.includes("My Drive")) return "";
  const line = raw.split(/\r?\n/).find((l) => l.includes("내 드라이브") || l.includes("My Drive")) || raw;
  const startIdx = line.includes("내 드라이브") ? line.indexOf("내 드라이브") : line.indexOf("My Drive");
  const parts = line.slice(startIdx).trim().split(">").map(cleanupPathPart).filter(Boolean);
  return parts.join(" > ");
}

/**
 * Google Drive/Docs 공유 링크에서 파일·폴더 ID 추출 — 링크만 붙여넣어도 내용을 읽게 한다.
 * 지원: drive.google.com/file/d/ID, open?id=ID, uc?id=ID, /drive(/u/N)/folders/ID,
 *       docs.google.com/{document|spreadsheets|presentation}/d/ID
 * @returns {{fileId: string} | {folderId: string} | null}
 */
export function detectDriveLink(message = "") {
  const raw = String(message || "");
  let m = raw.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([A-Za-z0-9_-]{10,})/);
  if (m) return { fileId: m[1] };
  m = raw.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/);
  if (m) return { folderId: m[1] };
  m = raw.match(/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return { fileId: m[1] };
  return null;
}

/**
 * 프롬프트 문장에서 Drive 검색용 키워드를 뽑는다(링크 ID가 잘못됐을 때 실제 항목을 찾는 용도).
 * 식별자형 토큰(QM008, ZAQMR0110 등)을 최우선, 그 외 의미있는 단어(길이>=4) 순.
 * URL·드라이브 명령어·흔한 동사는 노이즈라 제거한다.
 * @returns {string[]} 최대 6개
 */
export function extractSearchKeywords(text) {
  let s = String(text || "").replace(/https?:\/\/\S+/g, " ").replace(/[#>/]/g, " ");
  s = s.replace(/구글\s*드라이브|드라이브|google\s*drive|my\s*drive|mydrive|gdrive|폴더|파일|리뷰|읽고|읽어|분석|요약|정리|확인|검색|찾아|찾아줘|보여|열어|알려|생성|작성|저장|만들어|해줘|하려고|참고|참조|규칙|하위|안의|맞게|새|후|및/gi, " ");
  const toks = s.split(/[\s,.，()[\]{}'"·–—_]+/).map((t) => t.trim()).filter(Boolean);
  const idLike = toks.filter((t) => /^[A-Za-z]{1,6}\d{2,}$/.test(t) || /^[A-Z]{2,}\d+$/.test(t));
  const others = toks.filter((t) => !idLike.includes(t) && t.length >= 4 && /[A-Za-z0-9가-힣]/.test(t));
  const seen = new Set(), out = [];
  for (const t of [...idLike, ...others]) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out.slice(0, 6);
}
