const { requireAuth } = require("../_lib/auth");
const pool = require("../_lib/db.cjs");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Método no permitido" });

  try {
    const user = await requireAuth(req, res);
    const role = String(user?.rol || "").toLowerCase().trim();
    const isAdmin = role === "admin" || role === "superadmin" || role.includes("admin");
    if (!isAdmin) return res.status(403).json({ success: false, error: "Solo administradores" });

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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let updated = 0;
      for (const e of edits) {
        const id = Number(e?.id);
        const field = String(e?.field || "");
        const value = e?.value ?? null;

        if (!id || !ALLOWED.has(field)) continue;

        // OJO: el campo se inserta solo si está whitelisted
        const q = `UPDATE public.registros_trimestral SET ${field} = $1 WHERE id = $2`;
        await client.query(q, [value, id]);
        updated++;
      }

      await client.query("COMMIT");
      return res.json({ success: true, updated });
    } catch (err) {
      await client.query("ROLLBACK");
      return res.status(500).json({ success: false, error: err.message || "Error DB" });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || "Error" });
  }
};
