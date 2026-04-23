import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";

function norm(value) {
  return String(value ?? "").trim();
}

function toInt(value, fallback) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function getDetalleDependencia(dependencia, limit) {
  const personas = await pool.query(
    `
      SELECT
        id,
        nombre,
        primer_apellido,
        segundo_apellido,
        id_rusp,
        anio,
        trimestre,
        nivel_educativo,
        institucion_educativa,
        modalidad,
        estado_avance,
        enlace_nombre,
        enlace_primer_apellido,
        enlace_segundo_apellido,
        usuario_registro,
        created_at
      FROM public.registros_trimestral
      WHERE UPPER(BTRIM(dependencia)) = UPPER(BTRIM($1))
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $2
    `,
    [dependencia, limit]
  );

  const evidencias = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        MAX(COALESCE(updated_at, created_at)) AS ultima_carga
      FROM public.evidencias_mensuales
      WHERE UPPER(BTRIM(dependencia)) = UPPER(BTRIM($1))
    `,
    [dependencia]
  );

  return {
    dependencia,
    personas: personas.rows || [],
    evidencias: evidencias.rows?.[0] || { total: 0, ultima_carga: null },
  };
}

async function getResumenSeguimiento() {
  const result = await pool.query(`
    WITH registros AS (
      SELECT
        UPPER(BTRIM(dependencia)) AS dep_key,
        MIN(BTRIM(dependencia)) AS dependencia,
        MAX(NULLIF(BTRIM(ramo_ur), '')) AS ramo_ur,
        COUNT(*)::int AS registros,
        MAX(created_at) AS ultima_registro
      FROM public.registros_trimestral
      WHERE NULLIF(BTRIM(dependencia), '') IS NOT NULL
      GROUP BY UPPER(BTRIM(dependencia))
    ),
    evidencias AS (
      SELECT
        UPPER(BTRIM(dependencia)) AS dep_key,
        MIN(BTRIM(dependencia)) AS dependencia,
        COUNT(*)::int AS evidencias,
        MAX(COALESCE(updated_at, created_at)) AS ultima_evidencia
      FROM public.evidencias_mensuales
      WHERE NULLIF(BTRIM(dependencia), '') IS NOT NULL
      GROUP BY UPPER(BTRIM(dependencia))
    )
    SELECT
      COALESCE(r.dep_key, e.dep_key) AS dep_key,
      COALESCE(r.dependencia, e.dependencia) AS dependencia,
      COALESCE(r.ramo_ur, '') AS ramo_ur,
      COALESCE(r.registros, 0)::int AS registros,
      COALESCE(e.evidencias, 0)::int AS evidencias,
      NULLIF(
        GREATEST(
          COALESCE(r.ultima_registro, TIMESTAMPTZ 'epoch'),
          COALESCE(e.ultima_evidencia, TIMESTAMPTZ 'epoch')
        ),
        TIMESTAMPTZ 'epoch'
      ) AS ultima_carga
    FROM registros r
    FULL OUTER JOIN evidencias e ON e.dep_key = r.dep_key
    ORDER BY COALESCE(r.dependencia, e.dependencia)
  `);

  return result.rows || [];
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "Metodo no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!isAdminSession(session)) {
    return res.status(403).json({ ok: false, error: "Acceso restringido" });
  }

  try {
    const detalle = String(req.query?.detalle || "").trim() === "1";
    if (detalle) {
      const dependencia = norm(req.query?.dependencia);
      if (!dependencia) {
        return res.status(400).json({ ok: false, error: "Dependencia requerida" });
      }

      const limit = Math.min(Math.max(toInt(req.query?.limit, 250), 1), 500);
      const data = await getDetalleDependencia(dependencia, limit);
      return res.status(200).json({ ok: true, ...data });
    }

    const rows = await getResumenSeguimiento();
    return res.status(200).json({
      ok: true,
      rows,
      total: rows.length,
    });
  } catch (error) {
    console.error("Error /api/dashboard/seguimiento:", error);
    return res.status(500).json({
      ok: false,
      error: "Error al consultar seguimiento institucional",
    });
  }
}
