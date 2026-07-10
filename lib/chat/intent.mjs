// lib/chat/intent.mjs — 사용자 메시지에서 의도(Drive / GitHub / TPM 에러)를 판별하는 순수 함수.
// api/chat.js 분리의 일부. 외부 의존 0 → node --test 로 전 분기 검증 가능.

/**
 * TPM(분당 토큰) 절약: 히스토리 문자 총량을 최근 우선으로 제한한다.
 * 첨부·Drive 컨텍스트가 겹치면 요청이 40K+ 토큰으로 불어나 429가 나던 문제의 1차 가드.
 * @param {Array<{role?: string, content?: string}>} history
 * @param {number} maxChars
 * @returns {Array<{role?: string, content?: string}>}
 */
export function trimHistoryByChars(history, maxChars = 24000) {
  const h = Array.isArray(history) ? history : [];
  let total = 0;
  const out = [];
  for (let i = h.length - 1; i >= 0; i--) {
    const len = String(h[i]?.content || "").length;
    if (out.length && total + len > maxChars) break; // 최소 1개(최신)는 유지
    total += len;
    out.unshift(h[i]);
  }
  return out;
}

/**
 * OpenAI 429/TPM 초과 에러인가 (자동 폴백 대상 판별).
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTpmError(err) {
  const m = String((err && err.message) || err || "");
  return /\b429\b|tokens per min|Request too large|rate[ _-]?limit/i.test(m);
}

/**
 * Google Drive 의도 감지 (정밀).
 *
 * ⚠️ 과거엔 영어 'drive' 부분 문자열('driver'/'driven'/'OneDrive')과 '아무 줄이나 #로 시작'
 *    (마크다운 제목, 파이썬/셸 주석, C '#include')에도 발동해 무관한 Drive 전체 스캔 +
 *    최대 28K자 무관 내용 주입 + web_search 비활성화가 일어났다.
 *    → 명시적 의도(한국어 '드라이브', 'my/google drive' 단어, Drive/Docs 링크, '#명령' 규약)만 인식.
 * @param {string} message
 * @returns {boolean}
 */
export function detectDriveIntent(message) {
  const raw = String(message || "");
  const msg = raw.toLowerCase();
  if (/내 드라이브|드라이브/.test(raw)) return true;                       // 한국어는 기존 UX 유지
  if (/\b(?:my|google)\s*drive\b|\bgdrive\b/.test(msg)) return true;      // 영어는 수식어+단어 경계 필수
  if (/drive\.google\.com|docs\.google\.com/.test(msg)) return true;      // 공유 링크
  if (/#폴더/.test(raw)) return true;
  // '#폴더명' 명령 규약: '#'+비공백으로 시작하는 짧은 줄만.
  // '# 제목'(공백), '##…', '#!'(셔뱅), C/전처리 지시문, 80자 초과 줄은 본문으로 간주.
  for (const l of raw.split(/\r?\n/)) {
    const t = l.trim();
    if (!/^#[^#\s!]/.test(t)) continue;
    if (/^#(?:include|define|pragma|if|ifdef|ifndef|endif|else|elif|error|undef|region|endregion)\b/i.test(t)) continue;
    if (t.length > 80) continue;
    return true;
  }
  return false;
}

// 레포 코드 파일만 GitHub 액션 대상 — SAP/업무 파일(.abap/.pdf/.xlsx)은 일반 질문으로 넘긴다.
const isRepoFile = (p) => /\.(html?|m?jsx?|tsx?|json|css|md|ya?ml|sh|py|env|toml)$/i.test(String(p));

/**
 * GitHub 의도 감지 (정밀).
 *
 * ⚠️ 일반 업무 질문(예: "이 부분 스펙 정리해줘. SAP QM CBO프로그램")이 관리 액션으로
 *    오인되어 "auth 폴더 정리 완료" 같은 엉뚱한 답을 반환하던 버그 수정.
 *    → 아주 명시적인 관리자 명령일 때만 액션으로 처리하고, 그 외는 전부 AI가 답하게 한다.
 * @param {string} message
 * @returns {{type: "auth_cleanup"} | {type: "read", path: string} | {type: "update_intent", path: string} | {type: "github_status"} | null}
 */
export function detectGitHubIntent(message) {
  const raw = String(message || "");
  const m = raw.toLowerCase();

  // auth 폴더 정리 — 반드시 'auth' 뒤에 '폴더/cleanup' 이 붙은 명시 명령일 때만.
  // ('author'·'OAuth'·'정리' 단독 등 흔한 단어에는 절대 걸리지 않게)
  const authCmd = /auth[\s_-]*(폴더|cleanup|클린업)/.test(m) || m.includes("auth-cleanup") || m.includes("auth cleanup");
  if (authCmd && /(정리|cleanup|클린업|clean)/.test(m)) {
    return { type: "auth_cleanup" };
  }

  // 파일 읽기/수정 — 대상이 '레포 코드 파일'(.html/.js/.json 등)일 때만.
  const readMatch = raw.match(/(?:읽어|불러|확인해|조회해|보여줘)[^\n]*?([a-zA-Z0-9_\-\/]+\.[a-zA-Z]{2,6})/);
  if (readMatch && isRepoFile(readMatch[1])) return { type: "read", path: readMatch[1] };
  const updateMatch = raw.match(/(?:수정|고쳐|변경|커밋|배포)[^\n]*?([a-zA-Z0-9_\-\/]+\.[a-zA-Z]{2,6})/);
  if (updateMatch && isRepoFile(updateMatch[1])) return { type: "update_intent", path: updateMatch[1] };

  // GitHub 상태 확인 — 'github' 명시가 있을 때만.
  if (m.includes("github") && (m.includes("확인") || m.includes("연결") || m.includes("상태"))) {
    return { type: "github_status" };
  }
  return null;
}

// ───────── 핸들러가 쓰는 키워드 게이트 (조건부 실행으로 불필요한 API 호출 제거) ─────────

/** 날씨 전용 직접 응답 경로를 탈지 여부 */
export function isWeatherQuery(message) {
  return /날씨|기온|우산|weather|forecast/i.test(String(message || ""));
}

/** web_search / 실시간 컨텍스트가 필요한 질의인가 */
export function needsRealtimeSearch(message) {
  return /구글|검색|최신|뉴스|오늘|지금|현재|실시간/.test(String(message || "").toLowerCase());
}

/** 날씨 관련 컨텍스트(검색 보강)가 필요한 질의인가 */
export function needsWeatherContext(message) {
  return /날씨|기온|우산|비|눈|더위|추위|forecast|weather/.test(String(message || "").toLowerCase());
}

/** SAP/업무 키워드가 있어 Drive 요약 검색이 유용한 질의인가 */
export function needsSapDriveSearch(message) {
  return /sap|qa32|qm|pp|abap|inspection|bom|migo|mb51|검사|품질|공정|자재|트랜잭션/.test(String(message || "").toLowerCase());
}
