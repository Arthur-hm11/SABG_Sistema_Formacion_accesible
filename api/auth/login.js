import crypto from "crypto";
import { serialize } from "cookie";
import bcrypt from "bcryptjs";
import pool from "../_lib/db.js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
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

    // Token de sesión (stateless; no requiere tabla sesiones)
    const sessionToken = crypto.randomBytes(48).toString("hex");

    const cookie = serialize("session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8, // 8 horas
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
