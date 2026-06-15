import XLSX from "xlsx";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { type, filename, content, rows } = req.body || {};

    if (type === "xlsx") {
      const data = Array.isArray(rows) ? rows : [["내용"], [String(content || "")]];
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stella");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename || "stella-result.xlsx"}"`);
      return res.status(200).send(buffer);
    }

    const ext = type === "html" ? "html" : "txt";
    res.setHeader("Content-Type", type === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename || `stella-result.${ext}`}"`);
    return res.status(200).send(String(content || ""));
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Export error" });
  }
}
