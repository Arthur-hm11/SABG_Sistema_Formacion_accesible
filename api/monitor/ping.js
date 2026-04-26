import { applyCors } from "../_lib/cors.js";
import pool from "../_lib/db.js";
import { ensureMonitoringTables } from "../_lib/monitoring.js";
import { readSabgSession } from "../_lib/session.js";

function clip(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: "No autorizado" });
  }

  try {
    await ensureMonitoringTables();

    const route = clip(req.body?.route || req.body?.section || "inicio", 160) || "inicio";
    const usuario = clip(session.usuario, 120).toUpperCase();
    const rol = clip(session.rol, 40).toLowerCase();
    const dependencia = clip(session.dependencia, 240);

    await pool.query(
      `
      INSERT INTO monitor_heartbeats (usuario, rol, dependencia, route, last_seen, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (usuario)
      DO UPDATE SET
        rol = EXCLUDED.rol,
        dependencia = EXCLUDED.dependencia,
        route = EXCLUDED.route,
        last_seen = NOW(),
        updated_at = NOW()
      `,
      [usuario, rol, dependencia, route]
    );

    return res.status(200).json({ success: true, ok: true });
  } catch (error) {
    console.error("Error /api/monitor/ping:", error);
    return res.status(500).json({ success: false, error: "Error del servidor" });
  }
}
