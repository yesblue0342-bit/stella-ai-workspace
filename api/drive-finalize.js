// api/drive-finalize.js (PART C1)
// resumable 업로드 완료 후: 공개 설정 + 가족 사진 폴더(KST 날짜별) 보관 + 재생/표시 URL 반환.
import { getDrive, FOLDER_MIME } from "../lib/drive-utils.js";
import { kstDateString, familyPhotoPath } from "../lib/kst-date.js";

export const config = { maxDuration: 30 };

async function makePublic(drive, fileId) {
  try {
    await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
  } catch (e) { console.warn("[drive-finalize] 공개 설정 실패:", e.message); }
}

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

async function archiveToFamily(drive, fileId, fileName) {
  const esc = (v) => String(v || "").replace(/'/g, "\\'");
  const kstDate = kstDateString(new Date());
  const folderId = await ensureFamilyDateFolder(drive, kstDate);
  const dup = await drive.files.list({
    q: `name='${esc(fileName)}' and '${esc(folderId)}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1
  });
  if (dup.data.files?.[0]) return { archived: true, deduped: true, kstDate };
  await drive.files.copy({ fileId, requestBody: { name: fileName, parents: [folderId] }, fields: "id" });
  return { archived: true, deduped: false, kstDate };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  try {
    const { fileId, fileName, archiveFamily } = req.body || {};
    if (!fileId) return res.status(400).json({ ok: false, message: "fileId 필요" });
    const drive = getDrive();

    await makePublic(drive, fileId);

    // 이미지: lh3 썸네일이 안정적 / 동영상: uc 스트리밍 URL
    const imageUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
    const streamUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    let archive = null;
    if (archiveFamily) {
      try { archive = await archiveToFamily(drive, fileId, fileName || fileId); }
      catch (e) { console.warn("[drive-finalize] 가족 폴더 보관 실패:", e.message); archive = { archived: false, error: e.message }; }
    }

    return res.status(200).json({ ok: true, fileId, imageUrl, streamUrl, downloadUrl, archive });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
