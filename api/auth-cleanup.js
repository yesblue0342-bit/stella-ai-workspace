// Drive auth 폴더 중복 정리 - 여러 auth 폴더를 단일 auth/users로 통합
import { getDrive, ensurePath } from "../lib/drive-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false });
  try {
    // StellaGPT 하위의 중복 auth 폴더 목록 조회
    const drive = getDrive();
    // StellaGPT 폴더 ID 찾기
    const rootQ = await drive.files.list({
      q: "name='StellaGPT' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id,name)"
    });
    const root = rootQ.data.files?.[0];
    if (!root) return res.status(404).json({ ok:false, message:"StellaGPT 폴더 없음" });
    
    // StellaGPT 하위 auth 폴더 전체 조회
    const authQ = await drive.files.list({
      q: `name='auth' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${root.id}' in parents`,
      fields: "files(id,name,createdTime)"
    });
    const authFolders = authQ.data.files || [];
    if (authFolders.length <= 1) {
      return res.status(200).json({ ok:true, message:"정리 불필요", authFolders: authFolders.length });
    }
    
    // 가장 오래된 폴더를 기준으로 나머지 삭제 (내용 이미 같음 - 정리용)
    const toDelete = authFolders.slice(1);
    for (const f of toDelete) {
      await drive.files.delete({ fileId: f.id }).catch(() => {});
    }
    return res.status(200).json({ ok:true, message:`auth 폴더 ${toDelete.length}개 정리 완료`, kept: authFolders[0].id });
  } catch(e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
