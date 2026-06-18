// api/download.js — Drive 파일을 서버 OAuth로 받아 브라우저로 attachment 스트리밍
// 대용량(40MB+)도 메모리에 통째로 안 올리고 흘려보낸다.
import { Readable } from 'node:stream';

// 기존 Drive 인증(refresh token → access token) 재사용. 테스트에선 __TEST_TOKEN__ 사용.
async function getAccessToken() {
  if (process.env.__TEST_TOKEN__) return process.env.__TEST_TOKEN__;
  const { getDriveAccessToken } = await import('../lib/drive-utils.js');
  return getDriveAccessToken();
}

// 한글 등 비ASCII 파일명을 안전하게 Content-Disposition에 싣는다 (RFC 5987)
export function buildContentDisposition(filename) {
  const safe = String(filename || 'download');
  const asciiFallback = safe.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export default async function handler(req, res) {
  try {
    const fileId = (req.query && req.query.fileId) || (req.body && req.body.fileId);
    if (!fileId) return res.status(400).json({ error: 'fileId required' });

    const token = await getAccessToken();
    const auth = { Authorization: `Bearer ${token}` };

    // 1) 메타데이터
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size&supportsAllDrives=true`,
      { headers: auth }
    );
    if (!metaRes.ok) return res.status(metaRes.status).json({ error: 'meta_failed' });
    const meta = await metaRes.json();

    // 구글 네이티브 문서는 alt=media 불가 → 거절 (일반 업로드 파일만 대상)
    if (String(meta.mimeType || '').startsWith('application/vnd.google-apps'))
      return res.status(415).json({ error: 'google_native_unsupported' });

    res.setHeader('Content-Disposition', buildContentDisposition(meta.name));
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    if (meta.size) res.setHeader('Content-Length', meta.size);
    res.setHeader('Cache-Control', 'no-store');

    // 2) 바이트 스트리밍 (버퍼링 없이)
    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: auth }
    );
    if (!fileRes.ok || !fileRes.body) return res.status(fileRes.status || 502).json({ error: 'media_failed' });

    res.statusCode = 200;
    Readable.fromWeb(fileRes.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'download_exception', message: String(e?.message || e) });
  }
}
