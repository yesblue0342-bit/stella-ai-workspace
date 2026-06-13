import { saveJsonToDrive } from "./drive-utils.js";

export default async function handler(req, res) {
  try {
    const saved = await saveJsonToDrive({
      folderPath: ["SystemTest"],
      fileName: "drive-test.json",
      data: {
        type: "driveTest",
        message: "Stella Google Drive save test",
        method: req.method,
        createdAt: new Date().toISOString()
      }
    });

    return res.status(200).json({ ok: true, message: "Google Drive 저장 테스트 완료", saved });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Google Drive 저장 테스트 실패", error: error.message });
  }
}
