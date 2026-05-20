import crypto from "crypto";
import bcrypt from "bcryptjs";
import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { ensureMonitoringTables, logAuditEvent } from "../_lib/monitoring.js";
import {
  buildSabgSessionCookie,
  ensureUserSessionColumns,
  getActiveSessionTtlSeconds,
  getSessionRole,
} from "../_lib/session.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  if (req.method !== "POST")
    return res.status(405).json({ success: false, error: "Método no permitido" });

  const { usuario, password } = req.body || {};
  const usuarioInput = String(usuario || "").trim();
  if (!usuarioInput || !password)
    return res.status(400).json({ success: false, error: "Faltan credenciales" });

  try {
    await ensureUserSessionColumns();

    const q = `
      SELECT id, usuario, password_hash, nombre, rol, dependencia
      FROM public.usuarios
      WHERE LOWER(TRIM(usuario)) = LOWER($1)
      ORDER BY CASE WHEN usuario = $1 THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `;
    const r = await pool.query(q, [usuarioInput]);

    if (!r.rows || r.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Credenciales inválidas" });
    }

    const u = r.rows[0];

    const ok = await bcrypt.compare(String(password), String(u.password_hash));
    if (!ok) {
      return res.status(401).json({ success: false, error: "Credenciales inválidas" });
    }

    const normalizedRole = getSessionRole(u);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = nowSeconds + (60 * 60 * 8);
    const activeSessionExp = nowSeconds + getActiveSessionTtlSeconds();
    let sid = null;

    if (normalizedRole !== "superadmin") {
      sid = crypto.randomUUID();
      const lockResult = await pool.query(
        `
          UPDATE public.usuarios
          SET active_session_id = $2,
              active_session_expires_at = TO_TIMESTAMP($3)
          WHERE id = $1
            AND (
              active_session_id IS NULL
              OR active_session_expires_at IS NULL
              OR active_session_expires_at <= NOW()
            )
          RETURNING id
        `,
        [u.id, sid, activeSessionExp]
      );

      if ((lockResult.rowCount || 0) === 0) {
        return res.status(409).json({
          success: false,
          error: "Esta cuenta ya tiene una sesión activa. Debe cerrarla antes de iniciar otra.",
        });
      }
    }

    const payload = {
      id: u.id,
      usuario: u.usuario,
      rol: u.rol,
      dependencia: u.dependencia,
      exp,
    };
    if (sid) payload.sid = sid;

    const cookie = buildSabgSessionCookie(req, payload);
    res.setHeader("Set-Cookie", cookie);

    try {
      await ensureMonitoringTables();
      const usuarioUp = String(u.usuario || "").trim().toUpperCase();
      const rol = String(u.rol || "").trim().toLowerCase();
      const dependencia = String(u.dependencia || "").trim();
      const route = "inicio";

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
        [usuarioUp, rol, dependencia, route]
      );

      await logAuditEvent({
        usuario: usuarioUp,
        accion: "LOGIN",
        modulo: "auth",
        detalle: {
          ok: true,
          rol,
          dependencia,
        },
        ip: req.headers["x-forwarded-for"]?.toString().split(",")[0],
        userAgent: req.headers["user-agent"],
      });
    } catch (monitorError) {
      console.error("Error registrando monitoreo de login:", monitorError);
    }

    return res.json({
      success: true,
      usuario: u.usuario,
      nombre: u.nombre,
      rol: u.rol,
      dependencia: u.dependencia,
    });
  } catch (err) {
    console.error("Error /api/auth/login:", err);
    return res.status(500).json({ success: false, error: "Error interno" });
  }
}
// deploy ping 20260223_154135
