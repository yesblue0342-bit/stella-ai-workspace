// Resumable Upload 세션 URL 발급
// 브라우저가 이 URL로 파일을 직접 청크 전송 → 서버 부하 없이 대용량 가능

async function getAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth 환경변수 미설정");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("access_token 획득 실패");
  return d.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  try {
    const { parentId, fileName, mimeType, fileSize } = req.body || {};
    if (!parentId || !fileName) return res.status(400).json({ ok: false, message: "parentId, fileName 필요" });

    const token = await getAccessToken();
    const mt = mimeType || "application/octet-stream";

    // Resumable 업로드 세션 시작 요청
    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mt,
          ...(fileSize ? { "X-Upload-Content-Length": String(fileSize) } : {})
        },
        body: JSON.stringify({ name: String(fileName), parents: [parentId], mimeType: mt })
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      return res.status(500).json({ ok: false, message: "세션 생성 실패", error: errText });
    }

    // 발급된 업로드 URL (브라우저가 이 URL로 직접 파일 전송)
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) return res.status(500).json({ ok: false, message: "업로드 URL 발급 실패" });

    return res.status(200).json({ ok: true, uploadUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
