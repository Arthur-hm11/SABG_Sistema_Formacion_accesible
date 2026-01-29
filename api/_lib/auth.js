const cookie = require("cookie");

/**
 * Valida sesión por cookie "session_token" contra tabla "sesiones".
 * - Requiere: tabla sesiones(token, usuario_id, expires_at)
 * - Devuelve: { id, usuario, rol, nombre, dependencia } o null (ya responde 401)
 */
async function requireAuth(req, res, pool) {
  try {
    const raw = req.headers?.cookie || "";
    const cookies = cookie.parse(raw || "");
    const token = cookies.session_token;

    if (!token) {
      res.status(401).json({ ok: false, error: "No autenticado (sin sesión)" });
      return null;
    }

    // Limpieza ligera de sesiones vencidas (no rompe)
    await pool.query(`DELETE FROM sesiones WHERE expires_at < NOW()`);

    const r = await pool.query(
      `
      SELECT u.id, u.usuario, u.rol, u.nombre, u.dependencia
      FROM sesiones s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = $1 AND s.expires_at > NOW()
      LIMIT 1
      `,
      [token]
    );

    if (!r.rows.length) {
      res.status(401).json({ ok: false, error: "Sesión inválida o expirada" });
      return null;
    }

    // Adjunta user por si lo ocupas en logs/roles
    req.user = r.rows[0];
    return req.user;
  } catch (e) {
    res.status(500).json({ ok: false, error: "Auth error: " + String(e?.message || e) });
    return null;
  }
}

module.exports = { requireAuth };
