// lib/drive-utils.js — Google Drive 유틸의 공개 진입점(배럴).
//
// 원래 이 파일 하나가 1057줄이었다. 인증·폴더·JSON저장소·텍스트추출·경로감지·채팅컨텍스트가
// 뒤섞여 있어 순수 로직만 따로 테스트할 수 없었다 → lib/drive/* 로 분리했다.
// 20여 개 호출부(api/*, lib/*)가 이 경로에서 import 하므로 공개 이름은 그대로 유지한다.
//
//   drive/client.js       OAuth 클라이언트, 환경변수, MIME 상수, 이름/질의 정규화
//   drive/detect.js       경로·링크·키워드 감지, 질의 발췌 (순수)
//   drive/folders.js      폴더 탐색/생성/목록/검색, 경로→ID 해석
//   drive/json-store.js   Drive를 JSON 문서 저장소로 사용
//   drive/file-text.js    xlsx/docx/pdf/pptx/plain 텍스트 추출 (버퍼 in → 텍스트 out)
//   drive/read.js         파일/폴더를 실제로 읽어 텍스트 배열로
//   drive/chat-context.js 채팅 메시지 → Drive 컨텍스트 프롬프트

export {
  FOLDER_MIME,
  getDrive,
  getDriveAccessToken,
  getDriveEnvDiagnostics,
  getDriveRootId,
  getNotesFolderId,
  normalizeDriveFolderId,
  normalizeDriveError,
  driveFileLink,
} from "./drive/client.js";

export {
  condenseForQuery,
  detectDriveLink,
  detectDrivePathText,
  extractSearchKeywords,
} from "./drive/detect.js";

export {
  ensurePath,
  findFolderByName,
  getDriveRootIdSafe,
  listDriveDirectory,
  resolveDrivePath,
  resolvePathIfExists,
  searchDrive,
} from "./drive/folders.js";

export {
  listJsonFromDrive,
  listJsonIfExists,
  loadFromDrive,
  readJsonById,
  readJsonFromDrive,
  saveJsonToDrive,
  saveToDrive,
} from "./drive/json-store.js";

export { isExtractableDriveFile } from "./drive/file-text.js";

export { extractDriveFileText, readDriveTarget } from "./drive/read.js";

export { buildDriveContextForChat } from "./drive/chat-context.js";
