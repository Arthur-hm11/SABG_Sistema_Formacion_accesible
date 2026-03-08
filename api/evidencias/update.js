import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";

function clean(v) {
  return String(v ?? "").trim();
}

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
    return res.status(403).json({ ok: false, error: "Solo administradores pueden actualizar la revisión." });
  }

  try {
    const evidenciaId = parseInt(String(req.body?.evidencia_id || ""), 10);
    const estadoRevision = clean(req.body?.estado_revision);
    const observaciones = clean(req.body?.observaciones_dceve);

    if (!Number.isFinite(evidenciaId) || evidenciaId <= 0) {
      return res.status(400).json({ ok: false, error: "evidencia_id inválido" });
    }

    const allowed = [
      "Pendiente",
      "En revisión",
      "Con observaciones",
      "Validada",
      "Rechazada"
    ];

    if (!allowed.includes(estadoRevision)) {
      return res.status(400).json({ ok: false, error: "estado_revision inválido" });
    }

    const r = await pool.query(
      `
      UPDATE public.evidencias_mensuales
      SET
        estado_revision = $1,
        observaciones_dceve = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING id, estado_revision, observaciones_dceve, updated_at
      `,
      [estadoRevision, observaciones || null, evidenciaId]
    );

    if (!r.rows?.length) {
      return res.status(404).json({ ok: false, error: "Evidencia no encontrada" });
    }

    return res.json({
      ok: true,
      row: r.rows[0]
    });
  } catch (e) {
    console.error("Error /api/evidencias/update:", e);
    return res.status(500).json({ ok: false, error: "Error al actualizar revisión DCEVE" });
  }
}
