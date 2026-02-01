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
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: "Faltan credenciales" });

  // ✅ Login compatible:
  // - Usuarios nuevos: password_hash (bcrypt)
  // - Usuarios legacy: password (texto plano)
  const q = `
    SELECT id, usuario, nombre, rol, dependencia, password, password_hash
    FROM usuarios
    WHERE usuario = $1
    LIMIT 1
  `;
  const r = await pool.query(q, [usuario]);

  if (r.rows.length === 0) return res.status(401).json({ error: "Credenciales inválidas" });

  const user = r.rows[0];

  let ok = false;
  if (user.password_hash) {
    ok = await bcrypt.compare(String(password), String(user.password_hash));
  } else if (user.password) {
    ok = String(user.password) === String(password);
  }

  if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

  const sessionToken = crypto.randomBytes(48).toString("hex");

  await pool.query(
    `INSERT INTO sesiones (usuario_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '8 hours')`,
    [user.id, sessionToken]
  );

  res.setHeader(
    "Set-Cookie",
    serialize("session_token", sessionToken, {
      httpOnly: true,
      secure: true,   // Vercel = HTTPS
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    })
  );

  return res.status(200).json({
    success: true,
    usuario: user.usuario,
    nombre: user.nombre,
    rol: user.rol,
    dependencia: user.dependencia ?? null,
  });
}
