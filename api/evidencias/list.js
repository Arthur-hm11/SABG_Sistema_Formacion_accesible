import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";

function toInt(v, def) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function cleanLike(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  return s;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const page = Math.max(toInt(req.query?.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query?.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const q = cleanLike(req.query?.q);
    const mes = cleanLike(req.query?.mes);
    const anio = cleanLike(req.query?.anio);
    const dependencia = cleanLike(req.query?.dependencia);

    const where = [];
    const params = [];
    const isAdmin = isAdminSession(session);
    const sessionDependencia = cleanLike(session.dependencia);

    if (!isAdmin) {
      if (!sessionDependencia) {
        return res.status(403).json({ ok: false, error: "Dependencia no autorizada" });
      }
      params.push(sessionDependencia);
      where.push(`UPPER(BTRIM(dependencia)) = UPPER(BTRIM($${params.length}))`);
    }

    if (mes) {
      params.push(`%${mes}%`);
      where.push(`mes ILIKE $${params.length}`);
    }

    if (anio) {
      params.push(String(anio));
      where.push(`CAST(anio AS TEXT) = $${params.length}`);
    }

    if (dependencia) {
      params.push(`%${dependencia}%`);
      where.push(`dependencia ILIKE $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(
        mes ILIKE ${p}
        OR CAST(anio AS TEXT) ILIKE ${p}
        OR enlace_nombre ILIKE ${p}
        OR enlace_primer_apellido ILIKE ${p}
        OR enlace_segundo_apellido ILIKE ${p}
        OR enlace_correo ILIKE ${p}
        OR dependencia ILIKE ${p}
        OR archivo_pdf_nombre ILIKE ${p}
        OR estado_revision ILIKE ${p}
        OR observaciones_dceve ILIKE ${p}
        OR CONCAT_WS(' ', enlace_nombre, enlace_primer_apellido, enlace_segundo_apellido) ILIKE ${p}
        OR CONCAT_WS(' ', enlace_primer_apellido, enlace_segundo_apellido, enlace_nombre) ILIKE ${p}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.evidencias_mensuales
       ${whereSql}`,
      params
    );

    const total = totalRes.rows?.[0]?.total ?? 0;

    params.push(limit);
    params.push(offset);

    const dataSql = `
      SELECT
        id,
        id AS evidencia_id,
        mes,
        anio,
        enlace_nombre,
        enlace_primer_apellido,
        enlace_segundo_apellido,
        enlace_correo,
        ${isAdmin ? "archivo_pdf_url" : "NULL::text AS archivo_pdf_url"},
        archivo_pdf_nombre,
        dependencia,
        usuario_registro,
        estado_revision,
        observaciones_dceve,
        created_at,
        updated_at
      FROM public.evidencias_mensuales
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const dataRes = await pool.query(dataSql, params);

    return res.status(200).json({
      ok: true,
      page,
      limit,
      total,
      rows: dataRes.rows || []
    });
  } catch (error) {
    console.error("Error /api/evidencias/list:", error);
    return res.status(500).json({
      ok: false,
      error: "Error al consultar evidencias mensuales"
    });
  }
}
