import pool from "../_lib/db.js";
import * as XLSX from "xlsx";

function toCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  const esc = (v) => {
    if (v === undefined || v === null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? '"' + s + '"' : s;
  };

  const lines = [];
  lines.push(headers.map(esc).join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h])).join(","));
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Método no permitido" });

  const format = String(req.query?.format || "xlsx").toLowerCase();

  try {
    const result = await pool.query(
      "SELECT * FROM registros_trimestral ORDER BY created_at DESC"
    );
    const rows = result.rows || [];

    if (format === "csv") {
      const csv = toCsv(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=registros_trimestral.csv");
      return res.status(200).send(csv);
    }

    // xlsx por defecto
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "registros_trimestral");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=registros_trimestral.xlsx");
    return res.status(200).send(buf);
  } catch (error) {
    console.error("Error /api/export/excel:", error);
    return res.status(500).json({ success: false, error: error?.message || String(error) });
  }
}
