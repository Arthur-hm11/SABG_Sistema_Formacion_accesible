import pool from "../_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    const edits = req.body?.edits;
    if (!Array.isArray(edits) || edits.length === 0) {
      return res.status(400).json({ success: false, error: "Sin cambios" });
    }

    const ALLOWED = new Set([
      "nivel_educativo",
      "institucion_educativa",
      "modalidad",
      "estado_avance",
      "observaciones"
    ]);

    // Transacción
    await pool.query("BEGIN");

    let updated = 0;
    for (const e of edits) {
      const id = Number(e?.id);
      const field = String(e?.field || "");
      const value = e?.value ?? null;

      if (!id || !ALLOWED.has(field)) continue;

      const q = `UPDATE public.registros_trimestral SET ${field} = $1 WHERE id = $2`;
      await pool.query(q, [value, id]);
      updated++;
    }

    await pool.query("COMMIT");
    return res.json({ success: true, updated });
  } catch (err) {
    try { await pool.query("ROLLBACK"); } catch (_) {}
    return res.status(500).json({ success: false, error: err?.message || "Error DB" });
  }
}
