/**
 * file-reader.client.js
 *
 * Stella Workspace
 * File Reader Module
 *
 * 지원:
 * - TXT
 * - CSV
 * - JSON
 * - PDF (준비)
 * - DOCX (준비)
 * - PPTX (준비)
 * - XLSX (준비)
 * - IMAGE OCR (준비)
 */

export const SUPPORTED_FILE_TYPES = [
  "txt",
  "csv",
  "json",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "png",
  "jpg",
  "jpeg",
  "webp"
];

export function getFileExtension(filename = "") {
  const parts = filename.split(".");

  if (parts.length < 2) {
    return "";
  }

  return parts.pop().toLowerCase();
}

export function isSupportedFile(filename) {
  const ext = getFileExtension(filename);

  return SUPPORTED_FILE_TYPES.includes(ext);
}

export async function readTextFile(file) {
  return await file.text();
}

export async function readJsonFile(file) {
  const text = await file.text();

  return JSON.parse(text);
}

export async function readCsvFile(file) {
  const text = await file.text();

  return {
    raw: text,
    rows: text
      .split("\n")
      .map(row => row.split(","))
  };
}

export async function readFile(file) {
  const ext = getFileExtension(file.name);

  switch (ext) {
    case "txt":
      return {
        type: "txt",
        content: await readTextFile(file)
      };

    case "json":
      return {
        type: "json",
        content: await readJsonFile(file)
      };

    case "csv":
      return {
        type: "csv",
        content: await readCsvFile(file)
      };

    case "pdf":
      return {
        type: "pdf",
        content: null,
        message: "PDF Reader 연결 필요"
      };

    case "docx":
      return {
        type: "docx",
        content: null,
        message: "DOCX Reader 연결 필요"
      };

    case "pptx":
      return {
        type: "pptx",
        content: null,
        message: "PPTX Reader 연결 필요"
      };

    case "xlsx":
      return {
        type: "xlsx",
        content: null,
        message: "XLSX Reader 연결 필요"
      };

    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
      return {
        type: "image",
        content: null,
        message: "OCR 연결 필요"
      };

    default:
      throw new Error(
        `지원하지 않는 파일 형식: ${ext}`
      );
  }
}

export default {
  SUPPORTED_FILE_TYPES,
  getFileExtension,
  isSupportedFile,
  readFile
};
