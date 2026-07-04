// api/drive-upload.js
// 이미지/파일을 서버에서 Drive에 업로드하고 공개 URL 반환
// base64 또는 multipart/form-data 지원

import { getDrive, getDriveRootIdSafe, FOLDER_MIME } from "../lib/drive-utils.js";
import { kstDateString, familyPhotoPath } from "../lib/kst-date.js";

// PART E: 첨부 사본을 "내 드라이브 / 0가족 / 1_사진 / stella talk / [KST날짜]" 에 보관.
// 실제 드라이브 루트('root')부터 폴더를 조회/생성한다(없으면 자동 생성). 폴더 id 반환.
async function ensureFamilyDateFolder(drive, kstDate) {
  const esc = (v) => String(v || "").replace(/'/g, "\\'");
  let parentId = "root";
  for (const name of familyPhotoPath(kstDate)) {
    const found = await drive.files.list({
      q: `mimeType='${FOLDER_MIME}' and name='${esc(name)}' and '${esc(parentId)}' in parents and trashed=false`,
      fields: "files(id)", pageSize: 1
    });
    if (found.data.files?.[0]) { parentId = found.data.files[0].id; continue; }
    const created = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] }, fields: "id"
    });
    parentId = created.data.id;
  }
  return parentId;
}

// 업로드된 파일을 가족 사진 날짜 폴더로 복사(사본). 같은 이름이 이미 있으면 중복 저장하지 않음.
async function archiveToFamily(drive, fileId, fileName, when) {
  const esc = (v) => String(v || "").replace(/'/g, "\\'");
  const kstDate = kstDateString(when || new Date());
  const folderId = await ensureFamilyDateFolder(drive, kstDate);
  // 중복 방지: 같은 이름 파일이 이미 그 날짜 폴더에 있으면 스킵
  const dup = await drive.files.list({
    q: `name='${esc(fileName)}' and '${esc(folderId)}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1
  });
  if (dup.data.files?.[0]) return { archived: true, deduped: true, folderId, kstDate, copyId: dup.data.files[0].id };
  const copy = await drive.files.copy({
    fileId, requestBody: { name: fileName, parents: [folderId] }, fields: "id"
  });
  return { archived: true, deduped: false, folderId, kstDate, copyId: copy.data.id };
}
// MemberChat/images 폴더 확보
async function ensureImagesFolder(drive, rootId) {
  const esc = (v) => String(v || "").replace(/'/g, "\\'");

  // MemberChat 폴더
  let chatId;
  const r1 = await drive.files.list({
    q: `mimeType='${FOLDER_MIME}' and name='MemberChat' and '${esc(rootId)}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1
  });
  if (r1.data.files?.[0]) {
    chatId = r1.data.files[0].id;
  } else {
    const c1 = await drive.files.create({
      requestBody: { name: "MemberChat", mimeType: FOLDER_MIME, parents: [rootId] },
      fields: "id"
    });
    chatId = c1.data.id;
  }

  // MemberChat/images 폴더
  const r2 = await drive.files.list({
    q: `mimeType='${FOLDER_MIME}' and name='images' and '${esc(chatId)}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1
  });
  if (r2.data.files?.[0]) return r2.data.files[0].id;

  const c2 = await drive.files.create({
    requestBody: { name: "images", mimeType: FOLDER_MIME, parents: [chatId] },
    fields: "id"
  });
  return c2.data.id;
}

// Drive 파일을 공개 공유 설정
async function makePublic(drive, fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" }
    });
  } catch (e) {
    // 공개 설정 실패해도 계속 진행
    console.warn("[drive-upload] 공개 설정 실패:", e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method Not Allowed" });

  try {
    const body = req.body || {};
    const base64Data = String(body.base64 || "");      // "data:image/jpeg;base64,/9j/..."
    const fileName = String(body.fileName || `img_${Date.now()}.jpg`);
    const mimeType = String(body.mimeType || "image/jpeg");

    if (!base64Data) return res.status(400).json({ ok: false, message: "base64 데이터가 없습니다." });

    // base64 디코딩
    const base64Body = base64Data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Body, "base64");
    if (!buffer.length) return res.status(400).json({ ok: false, message: "이미지 데이터 변환 실패" });

    const drive = getDrive();
    const rootId = await getDriveRootIdSafe();
    const folderId = await ensureImagesFolder(drive, rootId);

    // Drive에 업로드
    const { Readable } = await import("stream");
    const stream = Readable.from(buffer);

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        parents: [folderId]
      },
      media: { mimeType, body: stream },
      fields: "id,name,webViewLink,webContentLink"
    });

    const fileId = uploaded.data.id;
    if (!fileId) return res.status(500).json({ ok: false, message: "Drive 업로드 실패" });

    // 공개 공유 설정
    await makePublic(drive, fileId);

    // 직접 표시 가능한 URL (thumbnail API 방식이 가장 안정적)
    const imageUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
    // fallback URL
    const fallbackUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    // PART E: 가족 사진 폴더(KST 날짜별)로 사본 보관 — 메시지 전송 실패와 무관하게 best-effort
    let archive = null;
    if (body.archiveFamily) {
      try { archive = await archiveToFamily(drive, fileId, fileName, new Date()); }
      catch (e) { console.warn("[drive-upload] 가족 폴더 보관 실패:", e.message); archive = { archived: false, error: e.message }; }
    }

    return res.status(200).json({
      ok: true,
      fileId,
      imageUrl,
      fallbackUrl,
      webViewLink: uploaded.data.webViewLink || "",
      fileName,
      archive
    });
  } catch (error) {
    console.error("[drive-upload] 오류:", error.message);
    return res.status(500).json({ ok: false, message: error.message || "업로드 실패" });
  }
}
