const { Pool } = require("pg");
const crypto = require("crypto");
const cookie = require("cookie");
const bcrypt = require("bcrypt");

const conn =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const pool = new Pool({
  connectionString: conn,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

    const { usuario, password } = req.body || {};
    if (!usuario || !password) return res.status(400).json({ error: "Faltan credenciales" });

    // Traer hash real
    const q = `
      SELECT id, usuario, nombre, rol, dependencia, password_hash
      FROM usuarios
      WHERE usuario = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [usuario]);

    if (r.rows.length === 0) return res.status(401).json({ error: "Credenciales inválidas" });

    const user = r.rows[0];

    // Comparar contra hash
    const ok = await bcrypt.compare(String(password), String(user.password_hash || ""));
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    const sessionToken = crypto.randomBytes(48).toString("hex");

    await pool.query(
      `INSERT INTO sesiones (usuario_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '8 hours')`,
      [user.id, sessionToken]
    );

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
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};
