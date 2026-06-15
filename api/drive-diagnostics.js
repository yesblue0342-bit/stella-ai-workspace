import { getDriveEnvDiagnostics } from "../lib/drive-utils.js";

export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    service: "drive-diagnostics",
    diagnostics: getDriveEnvDiagnostics(),
    note: "값 전체는 노출하지 않고 prefix/suffix/형식만 표시합니다."
  });
}
