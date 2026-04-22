import crypto from "crypto";
import { serialize } from "cookie";
import bcrypt from "bcryptjs";
import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";

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
