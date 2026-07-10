// lib/chat/context.mjs — 모델 호출 전에 붙일 외부 컨텍스트(실시간 검색 / Google Drive) 준비.
// api/chat.js 분리의 일부.

import { detectSmartIntent, getSmartContextForMessage } from "../place-weather-utils.js";
import { buildDriveContextForChat, searchDrive } from "../drive-utils.js";

// Drive 파일 내용이 너무 크면 context 초과 방지를 위해 잘라낸다.
const DRIVE_PROMPT_MAX_CHARS = 28000;

/**
 * 장소/날씨 스마트 컨텍스트(웹검색 결과 요약)를 준비한다.
 * @returns {Promise<{used: boolean, context?: string, error?: string}>}
 */
export async function prepareSearchContext(message) {
  try {
    const smart = detectSmartIntent(message);
    if (smart === "place" || smart === "weather") {
      return await getSmartContextForMessage(message);
    }
  } catch (error) {
    return { used: false, error: error.message };
  }
  return { used: false };
}

/**
 * SAP/업무 키워드가 있을 때 StellaGPT 폴더를 검색해 상위 3건을 링크 요약으로 반환.
 * @returns {Promise<string|null>}
 */
export async function searchDriveContext(message) {
  try {
    const msg = String(message || "").toLowerCase();
    const driveKw = ["sap", "qa32", "qm", "pp", "abap", "inspection", "lot", "bom", "mr21", "migo", "mb51", "검사", "품질", "공정", "자재", "트랜잭션"];
    if (!driveKw.some((k) => msg.includes(k))) return null;
    // searchDrive는 {folder, files} 객체를 반환 — 배열로 다루면 length가 undefined라 항상 null이 되어
    // SAP 키워드 Drive 컨텍스트가 무음 실패하던 버그가 있었다.
    const result = await searchDrive(message, { scope: "StellaGPT", pageSize: 5 }).catch(() => null);
    const files = Array.isArray(result?.files) ? result.files : [];
    if (!files.length) return null;
    return files.slice(0, 3)
      .map((f) => `[Drive:${f.name}] ${f.webViewLink || ""}${f.modifiedTime ? ` (수정 ${String(f.modifiedTime).slice(0, 10)})` : ""}`)
      .join("\n");
  } catch { return null; }
}

/**
 * Drive 경로/링크를 해석해 파일 내용을 읽고, 모델에 넣을 메시지와 컨텍스트 요약을 만든다.
 * 읽기에 실패해도 던지지 않는다 — 모델이 "못 읽었다"고 정직하게 답하도록 안내문을 대신 붙인다.
 * @param {string} message 원본 사용자 메시지
 * @returns {Promise<{aiMessage: string, driveContext: string, actualDriveContext: object|null}>}
 */
export async function buildDriveContext(message) {
  try {
    const actualDriveContext = await buildDriveContextForChat(message);
    if (!actualDriveContext?.prompt) {
      // buildDriveContextForChat가 null 반환 = 경로 인식 실패
      return {
        aiMessage: message,
        actualDriveContext,
        driveContext: `⚠️ Drive 경로를 인식하지 못했습니다 (입력: "${String(message).slice(0, 50)}"). 내용을 지어내지 말고, 정확한 폴더명으로 다시 시도하라고 안내하세요.`,
      };
    }

    let driveContent = actualDriveContext.prompt;
    if (driveContent.length > DRIVE_PROMPT_MAX_CHARS) {
      driveContent = driveContent.slice(0, DRIVE_PROMPT_MAX_CHARS)
        + `\n\n⚠️ 파일이 너무 커서 앞부분(${DRIVE_PROMPT_MAX_CHARS.toLocaleString("en-US")}자)만 분석합니다. 전체 내용은 파일 링크로 열어보세요.`;
    }

    const files = actualDriveContext.files || [];
    const readNames = files.filter((f) => f.read).map((f) => f.name);
    const unreadNames = files.filter((f) => !f.read).map((f) => f.name);
    let driveContext = [
      `선택 경로: ${actualDriveContext.path}`,
      `실제로 읽은 파일(${readNames.length}개): ${readNames.join(", ") || "없음"}`,
      `읽지 못한 파일: ${unreadNames.join(", ") || "없음"}`,
    ].join("\n");
    if (readNames.length === 0) {
      driveContext += "\n\n⚠️ 읽은 파일이 0개입니다. 절대 내용을 지어내지 말고 파일을 읽지 못했다고 답하세요.";
    }

    return { aiMessage: message + driveContent, driveContext, actualDriveContext };
  } catch (driveErr) {
    return {
      aiMessage: message + `\n\n[STELLA_GOOGLE_DRIVE_READ_ERROR]\n${driveErr.message}\n[/STELLA_GOOGLE_DRIVE_READ_ERROR]\n\nDrive 파일 내용을 읽지 못했습니다.`,
      driveContext: `Drive 읽기 오류: ${driveErr.message}`,
      actualDriveContext: null,
    };
  }
}

/** 응답의 driveRead 필드(파일 목록 + 링크)를 만든다. 컨텍스트가 없으면 null. */
export function buildDriveReadSummary(actualDriveContext) {
  if (!actualDriveContext) return null;
  return {
    path: actualDriveContext.path,
    files: (actualDriveContext.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      read: !!f.read,
      error: f.error || "",
      link: f.link || (f.id
        ? ((f.isFolder || f.mimeType === "application/vnd.google-apps.folder")
          ? `https://drive.google.com/drive/folders/${f.id}`
          : `https://drive.google.com/file/d/${f.id}/view`)
        : ""),
    })),
  };
}
