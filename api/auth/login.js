const { Pool } = require("pg");
const crypto = require("crypto");
const cookie = require("cookie");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  // ⚠️ Asumimos password en TEXTO PLANO (porque tu login ya funciona así).
  // Si usas crypt(), lo cambiamos después.
  const q = `
    SELECT id, usuario, nombre, rol, dependencia
    FROM usuarios
    WHERE usuario = $1 AND password = $2
    LIMIT 1
  `;
  const r = await pool.query(q, [usuario, password]);

  if (r.rows.length === 0) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  const user = r.rows[0];
  const sessionToken = crypto.randomBytes(48).toString("hex");

  // Guarda sesión (tabla sesiones debe existir)
  await pool.query(
    `INSERT INTO sesiones (usuario_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '8 hours')`,
    [user.id, sessionToken]
  );

  // ✅ Cookie HttpOnly (Vercel = HTTPS)
  res.setHeader(
    "Set-Cookie",
    cookie.serialize("session_token", sessionToken, {
      httpOnly: true,
      secure: true,
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
};
