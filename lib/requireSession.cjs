const { Pool } = require("pg");
const cookie = require("cookie");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function requireSession(req, res) {
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.session_token;

  if (!token) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Sesión no iniciada" }));
    return null;
  }

  const q = `
    SELECT u.id, u.usuario, u.nombre, u.rol, u.dependencia
    FROM sesiones s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = $1
      AND s.expires_at > NOW()
    LIMIT 1
  `;
  const r = await pool.query(q, [token]);

  if (r.rows.length === 0) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Sesión expirada" }));
    return null;
  }

  return r.rows[0];
}

module.exports = { requireSession };
