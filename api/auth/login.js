import crypto from "crypto";
import { serialize } from "cookie";
import bcrypt from "bcryptjs";
import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { ensureMonitoringTables, logAuditEvent } from "../_lib/monitoring.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  if (req.method !== "POST")
    return res.status(405).json({ success: false, error: "Método no permitido" });

  const { usuario, password } = req.body || {};
  if (!usuario || !password)
    return res.status(400).json({ success: false, error: "Faltan credenciales" });

  try {
    const q = `
      SELECT id, usuario, password_hash, nombre, rol, dependencia
      FROM public.usuarios
      WHERE usuario = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [usuario]);

    if (!r.rows || r.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Credenciales inválidas" });
    }

    const u = r.rows[0];

    const ok = await bcrypt.compare(String(password), String(u.password_hash));
    if (!ok) {
      return res.status(401).json({ success: false, error: "Credenciales inválidas" });
    }

    // Sesión SABG (HMAC stateless) -> cookie sabg_session
    const secret = process.env.SESSION_SECRET || "";
    if (!secret) return res.status(500).json({ success:false, error:"Error interno" });

    const payload = {
      id: u.id,
      usuario: u.usuario,
      rol: u.rol,
      dependencia: u.dependencia,
      exp: Math.floor(Date.now()/1000) + (60 * 60 * 8)
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const sabg = `${payloadB64}.${sig}`;

    const isSecureRequest =
      String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ||
      req.secure === true ||
      process.env.RENDER === "true" ||
      process.env.NODE_ENV === "production";

    const cookie = serialize("sabg_session", sabg, {
      httpOnly: true,
      secure: isSecureRequest,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

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
