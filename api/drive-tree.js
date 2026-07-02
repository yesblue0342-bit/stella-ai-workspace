import { getDrive, getDriveRootId } from "../lib/drive-utils.js";
async function scanFolder(drive, folderId, name, depth, maxDepth, results) {
  if (depth > maxDepth) return;
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id,name,mimeType)",
      pageSize: 200
    });
    const files = res.data.files || [];
    const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    const jsons = files.filter(f => f.name.endsWith('.json'));
    results.push({
      path: name,
      folders: folders.map(f => f.name),
      jsonCount: jsons.length,
      jsonSample: jsons.slice(0, 3).map(f => f.name)
    });
    for (const folder of folders) {
      await scanFolder(drive, folder.id, name + '/' + folder.name, depth + 1, maxDepth, results);
    }
  } catch(e) {
    results.push({ path: name, error: e.message });
  }
}

export default async function handler(req, res) {
  try {
    const drive = getDrive();
    const rootId = await getDriveRootIdSafe();
    const results = [];
    await scanFolder(drive, rootId, 'StellaGPT', 0, 3, results);
    const noteRelated = results.filter(r =>
      /note|노트|board|post|게시/i.test(r.path) || r.jsonCount > 0
    );
    return res.status(200).json({
      ok: true,
      rootId: rootId.slice(0, 8) + '...',
      totalFolders: results.length,
      allPaths: results.map(r => `${r.path} [폴더:${(r.folders||[]).length} JSON:${r.jsonCount||0}]`),
      noteRelated
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
