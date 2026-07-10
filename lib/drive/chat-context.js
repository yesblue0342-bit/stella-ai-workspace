// lib/drive/chat-context.js — 채팅 메시지 → Drive 파일 내용 컨텍스트. lib/drive-utils.js 분리의 일부.
//
// 실패 경로가 많은 모듈이다(경로 오타, 링크 ID 오탈자, 빈 폴더, 추출 불가 형식…).
// 어떤 실패든 "내용을 지어내지 말라"는 지시가 담긴 prompt 를 돌려주는 것이 이 모듈의 계약이다.

import { FOLDER_MIME, driveFileLink, normalizeDriveError } from "./client.js";
import { detectDriveLink, detectDrivePathText, condenseForQuery, extractSearchKeywords } from "./detect.js";
import { resolveDrivePath, searchDrive } from "./folders.js";
import { readDriveTarget, extractDriveFileText } from "./read.js";

// 한글 위주 문서 50K자는 ~40K+ 토큰이 되어 TPM 한도가 낮은 조직(30K)에서 429를 유발했다.
const TOTAL_DRIVE_MAX = 22000;
// 파일별 하한 1,200자를 두면 9개 이상 읽었을 때 총량이 22K를 넘긴다 → 발췌 대상 파일 수를 8개로 제한.
const MAX_PROMPT_FILES = 8;

const noHallucinationBlock = (bodyLines) =>
  `\n\n[STELLA_GOOGLE_DRIVE_CONTEXT]\n${bodyLines}\n[/STELLA_GOOGLE_DRIVE_CONTEXT]\n\n중요 규칙:\n- 내용을 지어내지 말고 위 결과를 사용자에게 그대로 알리세요. 추측 금지.`;

/**
 * 링크 ID로 접근 실패 시, 프롬프트 키워드로 실제 Drive 항목을 찾아 읽어 자동 복구한다.
 * (I/l·0/O 혼동 등으로 링크 ID가 한 글자 틀렸어도 "QM008" 같은 키워드로 진짜 폴더를 찾아 대체.)
 * @returns {Promise<{data?: object, target?: object, pickName?: string, candidates?: object[]}>}
 */
async function recoverDriveByKeywords(msg) {
  const keywords = extractSearchKeywords(msg);
  const candidates = [];
  for (const kw of keywords) {
    let hits = [];
    try { hits = (await searchDrive({ query: kw, scope: "root", pageSize: 10 })).files || []; }
    catch (e) { continue; }
    if (!hits.length) continue;
    for (const h of hits) if (!candidates.some((c) => c.id === h.id)) candidates.push(h);
    // 폴더 우선(문서 묶음일 가능성), 없으면 파일. 이름에 키워드가 더 많이 겹치는 순.
    const scored = hits.map((h) => ({
      h,
      score: keywords.filter((k) => String(h.name || "").toLowerCase().includes(k.toLowerCase())).length,
      isFolder: h.mimeType === FOLDER_MIME,
    }));
    scored.sort((a, b) => (b.isFolder - a.isFolder) || (b.score - a.score));
    for (const s of scored) {
      const pick = s.h;
      try {
        const rd = await readDriveTarget(pick.mimeType === FOLDER_MIME
          ? { folderId: pick.id, recursive: true, maxFiles: 20 }
          : { fileId: pick.id });
        if ((rd.files || []).some((f) => f.read && f.text)) {
          return { data: rd, target: pick.mimeType === FOLDER_MIME ? { folderId: pick.id } : { fileId: pick.id }, pickName: pick.name };
        }
      } catch (e) { /* 다음 후보 */ }
    }
  }
  return { candidates };
}

// 드라이브 전체(또는 상위 폴더 범위) 키워드 검색으로 읽을 파일을 모은다.
async function keywordSearchFallback(path, kw) {
  let hits = [], searchErr = null;
  // "#폴더 > 키워드"처럼 경로가 여러 단계면, 상위 폴더 안에서 키워드 검색 우선
  const pathParts = String(path).split(">").map((s) => s.trim()).filter(Boolean);
  let scopedFolderId = null;
  if (pathParts.length >= 2) {
    try {
      const parent = await resolveDrivePath(pathParts.slice(0, -1).join(" > "));
      if (parent && parent.folderId) scopedFolderId = parent.folderId;
    } catch (e) { /* 상위 폴더 못 찾으면 전체 검색으로 폴백 */ }
  }
  try {
    if (scopedFolderId) hits = (await searchDrive({ query: kw, folderId: scopedFolderId, pageSize: 12 })).files || [];
    if (!hits.length) hits = (await searchDrive({ query: kw, scope: "root", pageSize: 12 })).files || [];
  } catch (e) { searchErr = (e && e.message) ? e.message : String(e); }
  if (!hits.length) return { ok: false, searchErr };

  const collected = [];
  let used = 0;
  for (const h of hits) {
    if (used >= 8 || collected.length >= 16) break;
    try {
      if (h.mimeType === FOLDER_MIME) {
        const sub = await readDriveTarget({ folderId: h.id, recursive: false, maxFiles: 8 });
        (sub.files || []).forEach((f) => collected.push(f));
      } else {
        collected.push(await extractDriveFileText(h.id));
      }
    } catch (e) { /* 이 항목만 건너뛴다 */ }
    used++;
  }
  return { ok: true, searchErr, data: { target: { id: "search", name: `검색: ${kw}`, mimeType: "search", type: "search" }, files: collected } };
}

// 링크로 지정했는데 읽지 못한 경우의 안내문(키워드 복구 실패 시).
function linkFailurePrompt({ link, targetErr, candidates }) {
  const candList = [...new Set(candidates.map((c) => `${c.name}${c.mimeType === FOLDER_MIME ? "/(폴더)" : ""}`))].slice(0, 8);
  const hint = candList.length ? `\n비슷한 항목 후보(이 중 맞는 것의 링크를 다시 주세요):\n- ${candList.join("\n- ")}` : "";
  const reason = targetErr
    ? `링크의 항목에 접근하지 못했습니다: ${targetErr}. 링크 ID의 대문자 I ↔ 소문자 l, 숫자 0 ↔ 대문자 O 혼동이 흔합니다.${hint}`
    : `폴더는 열렸지만 읽을 파일이 없었고(하위 폴더만/빈 폴더), 키워드로도 대체 항목을 찾지 못했습니다.${hint}`;
  return noHallucinationBlock(`Drive 링크 ID: ${link.fileId || link.folderId}\n결과: ${reason}`);
}

// 읽은 파일들을 질의 관련 부분 위주로 발췌해 프롬프트 본문을 만든다.
function renderReadFiles(readFiles, queryTerms) {
  const promptFiles = readFiles.slice(0, MAX_PROMPT_FILES);
  const skippedRead = readFiles.slice(MAX_PROMPT_FILES);
  const perFileMax = Math.max(1200, Math.floor(TOTAL_DRIVE_MAX / Math.max(1, promptFiles.length)));
  let anyTruncated = false;

  const readList = promptFiles.map((f, i) => {
    const c = condenseForQuery(f.text, queryTerms, perFileMax);
    if (c.truncated) anyTruncated = true;
    const link = driveFileLink(f);
    const head = `--- 읽은 파일 ${i + 1}: ${f.name} (${f.mimeType || ""})`
      + (link ? ` | 링크: ${link}` : "")
      + (c.truncated ? " | [질의 관련 부분 발췌]" : "") + " ---";
    return `${head}\n${c.text}`;
  }).join("\n\n");

  const truncNotice = anyTruncated
    ? "\n\n⚠️ 일부 파일이 너무 커서 질문 관련 부분만 발췌했습니다. 전체 내용은 위 '링크'로 열어보세요."
    : "";
  const skippedList = skippedRead.length
    ? "\n\n[읽었지만 발췌 생략(파일 수 초과)]\n" + skippedRead.map((f) => {
        const link = driveFileLink(f);
        return `- ${f.name}${link ? ` (${link})` : ""}`;
      }).join("\n")
    : "";

  return { readList, truncNotice, skippedList, promptCount: promptFiles.length, skippedCount: skippedRead.length };
}

/**
 * 메시지에서 Drive 경로/링크를 해석해 파일 내용을 읽고, 모델에 붙일 prompt 를 만든다.
 * Drive 의도가 전혀 없으면 null.
 * @returns {Promise<{path: string, target: object|null, files: object[], prompt: string}|null>}
 */
export async function buildDriveContextForChat(message = {}) {
  const msg = typeof message === "string" ? message : String(message?.message || "");
  // ★ Drive/Docs 공유 링크 직접 지원 — 링크만 붙여넣어도 해당 파일/폴더를 읽는다.
  const link = detectDriveLink(msg);
  let path = detectDrivePathText(msg) || (link ? (link.fileId ? "Drive 링크(파일)" : "Drive 링크(폴더)") : "");
  if (!path && !link) return null;

  // 1차: 링크가 있으면 ID로 바로 접근, 아니면 정확 폴더 경로 해석
  let target = null;
  if (link) {
    target = link;
  } else {
    try { target = await resolveDrivePath(path); }
    catch (e) { target = null; } // 폴더명 정확 매칭 실패 → 키워드 검색 폴백
  }

  let data = null;
  let targetErr = null;
  if (target) {
    // 폴더 타깃은 재귀적으로 읽는다 — 폴더 안에 (직접 파일이 아니라) 하위 폴더만 있는 흔한 구조에서
    // recursive:false면 0개로 잡혀 "읽을 수 없습니다"가 나던 버그 수정. 파일 타깃은 재귀 무의미.
    const isFolderTarget = !!target.folderId;
    try { data = await readDriveTarget({ ...target, recursive: isFolderTarget, maxFiles: isFolderTarget ? 20 : 12 }); }
    catch (e) { data = null; targetErr = normalizeDriveError(e); }
  }
  // 정확 경로로 실제 읽은 파일 수 (느슨한 매칭이 빈/엉뚱한 폴더를 잡았을 수 있음)
  const exactReadCount = data ? (data.files || []).filter((f) => f.read && f.text).length : 0;

  if (!data || exactReadCount === 0) {
    if (link) {
      const foundCount = (data && data.files) ? data.files.length : 0;
      // 접근 자체가 실패(not found/권한)했거나, 폴더는 열렸지만 파일 0개인 경우에만 키워드 복구 시도.
      if (targetErr || foundCount === 0) {
        const rec = await recoverDriveByKeywords(msg);
        if (rec && rec.data) {
          // 복구 성공 → data/target/path를 대체하고 아래 정상 렌더 경로로 진행.
          data = rec.data;
          target = rec.target;
          path = `링크 ID를 찾지 못해 키워드 검색으로 대체함 → "${rec.pickName}"`;
        } else {
          return {
            path, target: target || null, files: (data && data.files) || [],
            prompt: linkFailurePrompt({ link, targetErr, candidates: (rec && rec.candidates) || [] }),
          };
        }
      } else {
        // 파일은 찾았으나 추출 실패한 경우(형식/크기) — 사유를 파일별로 안내.
        const unreadReasons = (data.files || []).filter((f) => !f.read).map((f) => `${f.name}: ${f.error || "읽기 실패"}`).slice(0, 8);
        return {
          path, target: target || null, files: data.files || [],
          prompt: noHallucinationBlock(`Drive 링크 ID: ${link.fileId || link.folderId}\n결과: ${foundCount}개 항목을 찾았으나 텍스트를 추출하지 못했습니다.\n${unreadReasons.join("\n")}`),
        };
      }
    } else {
      // 경로 기반 폴백 — 드라이브 전체 키워드 검색
      const kw = String(path).split(">").pop().trim();
      const fb = await keywordSearchFallback(path, kw);
      if (fb.ok) {
        data = fb.data;
      } else {
        // 오류(주로 Drive 인증/권한)와 "일치 없음"을 구분해 정확히 안내
        const reason = fb.searchErr
          ? `드라이브 검색 중 오류: ${fb.searchErr} (Google Drive 연결/토큰(GOOGLE_REFRESH_TOKEN)/권한 확인 필요)`
          : `'${kw}' 키워드로 일치하는 파일/폴더가 없습니다. (정확한 폴더명 또는 키워드를 확인하세요)`;
        return {
          path, target: target || null, files: (data && data.files) || [],
          prompt: noHallucinationBlock(`검색 키워드: ${kw}\n결과: ${reason}`),
        };
      }
    }
  }
  if (!data) data = { target: target || null, files: [] };

  const readFiles = (data.files || []).filter((f) => f.read && f.text);
  const unreadFiles = (data.files || []).filter((f) => !f.read || !f.text);

  // 질의 관련 부분 위주 발췌로 토큰 초과 방지
  const queryTerms = String(msg).replace(/[#>/]/g, " ").split(/\s+/).map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 8);
  const { readList, truncNotice, skippedList, promptCount, skippedCount } = renderReadFiles(readFiles, queryTerms);

  const unreadList = unreadFiles.length
    ? "\n\n[읽지 못한 파일]\n" + unreadFiles.map((f) => `- ${f.name || f.id}: ${f.error || "파일 내용을 읽지 못했습니다"}`).join("\n")
    : "";

  return {
    path,
    target: data.target,
    files: (data.files || []).map((f) => ({ ...f, link: driveFileLink(f) })),
    prompt:
`\n\n[STELLA_GOOGLE_DRIVE_CONTEXT]
요청자가 입력한 경로: ${path}
실제로 읽은 파일 수: ${readFiles.length}${skippedCount ? ` (발췌 포함 ${promptCount}개)` : ""}
${readList || "파일 내용을 읽지 못했습니다."}${skippedList}${unreadList}${truncNotice}
[/STELLA_GOOGLE_DRIVE_CONTEXT]

중요 규칙:
- 위 Google Drive 실제 파일 내용만 근거로 답하세요.
- 파일 내용을 읽지 못한 항목은 추측하지 말고 "파일 내용을 읽지 못했습니다"라고 표시하세요.
- 경로명만 보고 내용을 만들어내면 안 됩니다.
- 답변 끝에 참고한 파일을 [파일명](링크) 형식의 markdown 링크로 출처 표기하세요(위 '링크:' 값 사용).`,
  };
}
