import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";

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

  try {
    const page = Math.max(toInt(req.query?.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query?.limit, 200), 1), 500);
    const offset = (page - 1) * limit;

    const q = cleanLike(req.query?.q);
    const dependencia = cleanLike(req.query?.dependencia);
    const anio = cleanLike(req.query?.anio);
    const mes = cleanLike(req.query?.mes);

    const where = [];
    const params = [];

    if (dependencia) {
      params.push(`%${dependencia}%`);
      where.push(`ev.dependencia ILIKE $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(
        ev.mes ILIKE ${p}
        OR CAST(ev.anio AS TEXT) ILIKE ${p}
        OR ev.enlace_nombre ILIKE ${p}
        OR ev.enlace_primer_apellido ILIKE ${p}
        OR ev.enlace_segundo_apellido ILIKE ${p}
        OR ev.enlace_correo ILIKE ${p}
        OR ev.dependencia ILIKE ${p}
        OR ev.archivo_pdf_nombre ILIKE ${p}
        OR ev.estado_revision ILIKE ${p}
        OR ev.observaciones_dceve ILIKE ${p}
        OR r.nombre ILIKE ${p}
        OR r.primer_apellido ILIKE ${p}
        OR r.segundo_apellido ILIKE ${p}
        OR r.correo_institucional ILIKE ${p}
        OR CONCAT_WS(' ', r.nombre, r.primer_apellido, r.segundo_apellido) ILIKE ${p}
        OR CONCAT_WS(' ', r.primer_apellido, r.segundo_apellido, r.nombre) ILIKE ${p}
      )`);
    }

    if (anio) {
      params.push(String(anio));
      where.push(`CAST(ev.anio AS TEXT) = $${params.length}`);
    }

    if (mes) {
      params.push(`%${mes}%`);
      where.push(`ev.mes ILIKE $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const fromSql = `
      FROM public.evidencias_mensuales ev
      LEFT JOIN LATERAL (
        SELECT
          rt.id,
          rt.nombre,
          rt.primer_apellido,
          rt.segundo_apellido,
          rt.correo_institucional,
          rt.created_at
        FROM public.registros_trimestral rt
        WHERE
          LOWER(BTRIM(COALESCE(rt.dependencia, ''))) = LOWER(BTRIM(COALESCE(ev.dependencia, '')))
          AND (
            LOWER(BTRIM(COALESCE(rt.enlace_correo, ''))) = LOWER(BTRIM(COALESCE(ev.enlace_correo, '')))
            OR LOWER(BTRIM(COALESCE(rt.enlace_correo, ''))) = LOWER(BTRIM(COALESCE(ev.usuario_registro, '')))
          )
        ORDER BY rt.created_at DESC NULLS LAST, rt.id DESC
        LIMIT 1
      ) r ON TRUE
    `;

    const totalRes = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      ${fromSql}
      ${whereSql}
      `,
      params
    );

    const total = totalRes.rows?.[0]?.total ?? 0;

    params.push(limit);
    params.push(offset);

    const dataSql = `
      SELECT
        COALESCE(r.id, 0) AS id,
        ev.id AS evidencia_id,
        ev.mes,
        ev.anio,
        r.nombre,
        r.primer_apellido,
        r.segundo_apellido,
        r.correo_institucional,
        ev.enlace_nombre,
        ev.enlace_primer_apellido,
        ev.enlace_segundo_apellido,
        ev.enlace_correo,
        ev.dependencia,
        ev.archivo_pdf_url,
        ev.archivo_pdf_nombre,
        ev.estado_revision,
        ev.observaciones_dceve,
        r.created_at AS created_at_registro,
        ev.created_at AS created_at_evidencia
      ${fromSql}
      ${whereSql}
      ORDER BY ev.created_at DESC NULLS LAST, ev.id DESC
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
      error: "Error al consultar panel de evidencias"
    });
  }
}
