// StellaGPT Drive 폴더 정리: auth 중복 제거 + 표준 폴더 구조 생성
import { getDrive } from "../lib/drive-utils.js";

const STANDARD_FOLDERS = [
  "auth",           // 회원인증 (auth/users 하위)
  "chats",          // 채팅 저장 (AI채팅)
  "boards",         // 게시판
  "member-chat",    // 회원간 채팅
  "files",          // 파일 업로드
  "backups",        // 백업
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  try {
    const drive = getDrive();

    // 1) StellaGPT 폴더 찾기
    const rootQ = await drive.files.list({
      q: "name='StellaGPT' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id,name)",
      pageSize: 5
    });
    const root = rootQ.data.files?.[0];
    if (!root) return res.status(404).json({ ok: false, message: "StellaGPT 폴더를 찾을 수 없습니다." });

    // 2) StellaGPT 하위 전체 폴더 조회
    const childQ = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and trashed=false and '${root.id}' in parents`,
      fields: "files(id,name,createdTime)",
      pageSize: 100
    });
    const children = childQ.data.files || [];

    // 3) auth 중복 정리 (같은 이름 폴더 여러 개 → 가장 오래된 1개만 유지)
    const byName = {};
    for (const f of children) {
      if (!byName[f.name]) byName[f.name] = [];
      byName[f.name].push(f);
    }

    const deleted = [];
    for (const [name, folders] of Object.entries(byName)) {
      if (folders.length <= 1) continue;
      // 오래된 순 정렬, 첫 번째 유지 나머지 삭제
      folders.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
      for (const f of folders.slice(1)) {
        await drive.files.delete({ fileId: f.id }).catch(() => {});
        deleted.push(f.name + "/" + f.id);
      }
    }

    // 4) 표준 폴더 없으면 생성
    const existing = Object.keys(byName);
    const created = [];
    for (const folderName of STANDARD_FOLDERS) {
      if (!existing.includes(folderName)) {
        const f = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [root.id]
          },
          fields: "id,name"
        });
        created.push(f.data.name);
      }
    }

    // 5) auth/users 하위폴더 확인
    const authFolder = children.find(f => f.name === "auth") || 
                       (await drive.files.list({
                         q: `name='auth' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${root.id}' in parents`,
                         fields: "files(id,name)", pageSize: 1
                       })).data.files?.[0];

    if (authFolder) {
      const usersQ = await drive.files.list({
        q: `name='users' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${authFolder.id}' in parents`,
        fields: "files(id)", pageSize: 1
      });
      if (!usersQ.data.files?.length) {
        await drive.files.create({
          requestBody: { name: "users", mimeType: "application/vnd.google-apps.folder", parents: [authFolder.id] },
          fields: "id"
        });
        created.push("auth/users");
      }
    }

    return res.status(200).json({
      ok: true,
      message: "StellaGPT 폴더 정리 완료",
      stellagpt_id: root.id,
      deleted_duplicates: deleted,
      created_folders: created,
      total_folders: children.length - deleted.length + created.length
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
