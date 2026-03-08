import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!isAdminSession(session)) {
    return res.status(403).json({ ok: false, error: "Solo administradores pueden eliminar evidencias." });
  }

  try {
    const idsRaw = Array.isArray(req.body?.evidencia_ids) ? req.body.evidencia_ids : [];
    const ids = idsRaw
      .map(v => parseInt(String(v), 10))
      .filter(v => Number.isFinite(v) && v > 0);

    if (!ids.length) {
      return res.status(400).json({ ok: false, error: "No se recibieron evidencias válidas para eliminar." });
    }

    const r = await pool.query(
      `
      DELETE FROM public.evidencias_mensuales
      WHERE id = ANY($1::int[])
      RETURNING id
      `,
      [ids]
    );

    return res.json({
      ok: true,
      deleted: r.rows.map(x => x.id),
      total: r.rowCount || 0
    });
  } catch (e) {
    console.error("Error /api/evidencias/delete:", e);
    return res.status(500).json({ ok: false, error: "Error al eliminar evidencias" });
  }
}
