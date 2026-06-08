import crypto from "crypto";
import bcrypt from "bcryptjs";
import pool from "../_lib/db.js";
import {
  buildSabgSessionCookie,
  ensureUserSessionColumns,
  getActiveSessionTtlSeconds,
  getSessionRole,
} from "../_lib/session.js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://sabg-sistema-formacion.onrender.com");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ success: false, error: "Método no permitido" });

  const { usuario, password } = req.body || {};
  if (!usuario || !password)
    return res.status(400).json({ success: false, error: "Faltan credenciales" });

  const usuarioNorm = String(usuario).trim().replace(/\s+/g, " ");

  try {
    const q = `
      SELECT id, usuario, password_hash, nombre, rol, dependencia
      FROM public.usuarios
      WHERE (
        UPPER(REGEXP_REPLACE(TRIM(usuario), '\s+', ' ', 'g')) =
        UPPER(REGEXP_REPLACE(TRIM($1), '\s+', ' ', 'g'))
      ) OR (
        TRANSLATE(
          UPPER(REGEXP_REPLACE(TRIM(usuario), '\s+', ' ', 'g')),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
          'AAAAAEEEEIIIIOOOOOUUUUN'
        ) =
        TRANSLATE(
          UPPER(REGEXP_REPLACE(TRIM($1), '\s+', ' ', 'g')),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
          'AAAAAEEEEIIIIOOOOOUUUUN'
        )
      )
      ORDER BY
        CASE
          WHEN usuario = $1 THEN 0
          WHEN UPPER(REGEXP_REPLACE(TRIM(usuario), '\s+', ' ', 'g')) =
               UPPER(REGEXP_REPLACE(TRIM($1), '\s+', ' ', 'g')) THEN 1
          ELSE 2
        END,
        id ASC
      LIMIT 1
    `;
    const r = await pool.query(q, [usuarioNorm]);

    if (!r.rows || r.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Credenciales inválidas" });
    }

    const u = r.rows[0];

    const ok = await bcrypt.compare(String(password), String(u.password_hash));
    if (!ok) {
      return res.status(401).json({ success: false, error: "Credenciales inválidas" });
    }

    await ensureUserSessionColumns();

    const role = getSessionRole(u);
    const ttlSeconds = getActiveSessionTtlSeconds();
    const sid = role === "superadmin" ? null : crypto.randomUUID();

    if (sid) {
      await pool.query(
        `
          UPDATE public.usuarios
          SET active_session_id = $2,
              active_session_expires_at = TO_TIMESTAMP($3)
          WHERE id = $1
        `,
        [
          u.id,
          sid,
          Math.floor(Date.now() / 1000) + ttlSeconds,
        ]
      );
    }

    const payload = {
      id: u.id,
      usuario: u.usuario,
      rol: u.rol,
      dependencia: u.dependencia,
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 8),
      ...(sid ? { sid } : {}),
    };

    const cookie = buildSabgSessionCookie(req, payload, 60 * 60 * 8);

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
