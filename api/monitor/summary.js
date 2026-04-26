import { applyCors } from "../_lib/cors.js";
import pool from "../_lib/db.js";
import {
  canViewMonitoringSession,
  ensureMonitoringTables,
  getMonitoringDisplayName,
} from "../_lib/monitoring.js";
import { readSabgSession } from "../_lib/session.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: "No autorizado" });
  }
  if (!canViewMonitoringSession(session)) {
    return res.status(403).json({ success: false, error: "No autorizado para monitoreo" });
  }

  try {
    await ensureMonitoringTables();

    const [
      totalsRes,
      rolesRes,
      activosRes,
      loginsRes,
      ingresosRes,
      registrosRes,
      evidenciasRes,
    ] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM usuarios) AS total_usuarios,
          (SELECT COUNT(*)::int FROM registros_trimestral) AS total_registros,
          (SELECT COUNT(*)::int FROM evidencias_mensuales) AS total_evidencias,
          (SELECT COUNT(*)::int FROM monitor_heartbeats WHERE last_seen >= NOW() - INTERVAL '5 minutes') AS activos_5m,
          (SELECT COUNT(*)::int FROM monitor_heartbeats WHERE last_seen >= NOW() - INTERVAL '15 minutes') AS activos_15m,
          (SELECT COUNT(*)::int FROM monitor_heartbeats WHERE last_seen >= NOW() - INTERVAL '60 minutes') AS activos_60m,
          (SELECT COUNT(*)::int FROM audit_logs WHERE accion = 'LOGIN' AND created_at >= date_trunc('day', NOW())) AS logins_hoy,
          (SELECT COUNT(*)::int FROM audit_logs WHERE accion = 'LOGIN' AND created_at >= NOW() - INTERVAL '24 hours') AS logins_24h,
          (SELECT COUNT(*)::int FROM audit_logs WHERE accion = 'LOGIN' AND created_at >= NOW() - INTERVAL '7 days') AS logins_7d
      `),
      pool.query(`
        SELECT COALESCE(NULLIF(TRIM(rol), ''), 'sin_rol') AS rol, COUNT(*)::int AS total
        FROM usuarios
        GROUP BY 1
        ORDER BY total DESC, rol ASC
      `),
      pool.query(`
        SELECT
          usuario,
          COALESCE(NULLIF(TRIM(rol), ''), 'sin_rol') AS rol,
          COALESCE(NULLIF(TRIM(dependencia), ''), 'SIN DEPENDENCIA') AS dependencia,
          COALESCE(NULLIF(TRIM(route), ''), 'sin_ruta') AS route,
          last_seen
        FROM monitor_heartbeats
        WHERE last_seen >= NOW() - INTERVAL '60 minutes'
        ORDER BY last_seen DESC
        LIMIT 25
      `),
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(a.usuario), ''), 'SIN USUARIO') AS usuario,
          COALESCE(NULLIF(TRIM(u.rol), ''), 'sin_rol') AS rol,
          COALESCE(NULLIF(TRIM(u.dependencia), ''), 'SIN DEPENDENCIA') AS dependencia,
          MAX(a.created_at) AS ultimo_login,
          COUNT(*)::int AS ingresos_7d
        FROM audit_logs a
        LEFT JOIN usuarios u
          ON UPPER(u.usuario) = UPPER(a.usuario)
        WHERE a.accion = 'LOGIN'
          AND a.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY 1, 2, 3
        ORDER BY ultimo_login DESC
        LIMIT 15
      `),
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(dependencia), ''), 'SIN DEPENDENCIA') AS dependencia,
          COUNT(*)::int AS activos
        FROM monitor_heartbeats
        WHERE last_seen >= NOW() - INTERVAL '15 minutes'
        GROUP BY 1
        ORDER BY activos DESC, dependencia ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(a.usuario), ''), 'SIN USUARIO') AS usuario,
          COALESCE(NULLIF(TRIM(u.rol), ''), 'sin_rol') AS rol,
          COALESCE(NULLIF(TRIM(COALESCE(a.detalle::jsonb->>'dependencia', u.dependencia)), ''), 'SIN DEPENDENCIA') AS dependencia,
          CONCAT_WS(' ',
            NULLIF(TRIM(a.detalle::jsonb->'persona'->>'nombre'), ''),
            NULLIF(TRIM(a.detalle::jsonb->'persona'->>'primer_apellido'), ''),
            NULLIF(TRIM(a.detalle::jsonb->'persona'->>'segundo_apellido'), '')
          ) AS persona_registrada,
          COALESCE(NULLIF(TRIM(a.detalle::jsonb->>'trimestre'), ''), '—') AS trimestre,
          COALESCE(NULLIF(TRIM(a.detalle::jsonb->>'anio'), ''), '—') AS anio,
          a.created_at
        FROM audit_logs a
        LEFT JOIN usuarios u
          ON UPPER(u.usuario) = UPPER(a.usuario)
        WHERE a.accion = 'REGISTRO_TRIMESTRAL_CREATE'
        ORDER BY a.created_at DESC
        LIMIT 15
      `),
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(a.usuario), ''), 'SIN USUARIO') AS usuario,
          COALESCE(NULLIF(TRIM(u.rol), ''), 'sin_rol') AS rol,
          COALESCE(NULLIF(TRIM(COALESCE(a.detalle::jsonb->>'dependencia', u.dependencia)), ''), 'SIN DEPENDENCIA') AS dependencia,
          CONCAT_WS(' ',
            NULLIF(TRIM(a.detalle::jsonb->'enlace'->>'nombre'), ''),
            NULLIF(TRIM(a.detalle::jsonb->'enlace'->>'primer_apellido'), ''),
            NULLIF(TRIM(a.detalle::jsonb->'enlace'->>'segundo_apellido'), '')
          ) AS enlace_registra,
          COALESCE(NULLIF(TRIM(a.detalle::jsonb->>'archivo_pdf_nombre'), ''), '—') AS archivo_pdf_nombre,
          COALESCE(NULLIF(TRIM(a.detalle::jsonb->>'mes'), ''), '—') AS mes,
          COALESCE(NULLIF(TRIM(a.detalle::jsonb->>'anio'), ''), '—') AS anio,
          a.created_at
        FROM audit_logs a
        LEFT JOIN usuarios u
          ON UPPER(u.usuario) = UPPER(a.usuario)
        WHERE a.accion = 'EVIDENCIA_UPLOAD'
        ORDER BY a.created_at DESC
        LIMIT 15
      `),
    ]);

    return res.status(200).json({
      success: true,
      generated_at: new Date().toISOString(),
      viewer: getMonitoringDisplayName(session),
      totals: totalsRes.rows[0] || {},
      roles: rolesRes.rows || [],
      active_users: activosRes.rows || [],
      recent_logins: loginsRes.rows || [],
      activity_by_dependencia: ingresosRes.rows || [],
      recent_registros: registrosRes.rows || [],
      recent_evidencias: evidenciasRes.rows || [],
    });
  } catch (error) {
    console.error("Error /api/monitor/summary:", error);
    return res.status(500).json({ success: false, error: "Error del servidor" });
  }
}
