import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!isAdminSession(session)) {
    return res.status(403).json({ ok: false, error: "Solo administradores pueden abrir archivos PDF." });
  }

  try {
    const evidenciaId = parseInt(String(req.query?.id || ""), 10);
    if (!Number.isFinite(evidenciaId) || evidenciaId <= 0) {
      return res.status(400).json({ ok: false, error: "id inválido" });
    }

    const r = await pool.query(
      `
      SELECT archivo_pdf_url
      FROM public.evidencias_mensuales
      WHERE id = $1
      LIMIT 1
      `,
      [evidenciaId]
    );

    if (!r.rows?.length) {
      return res.status(404).json({ ok: false, error: "Evidencia no encontrada" });
    }

    const url = String(r.rows[0].archivo_pdf_url || "").trim();
    if (!url) {
      return res.status(404).json({ ok: false, error: "La evidencia no tiene URL de PDF" });
    }

    return res.redirect(302, url);
  } catch (e) {
    console.error("Error /api/evidencias/pdf:", e);
    return res.status(500).json({ ok: false, error: "Error al abrir PDF" });
  }
}
