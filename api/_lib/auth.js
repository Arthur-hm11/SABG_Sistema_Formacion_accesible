const cookie = require("cookie");

/**
 * requireAuth: valida cookie session_token contra tabla sesiones.
 * Adjunta req.user = {id, usuario, rol, nombre, dependencia}
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

    // Limpieza ligera
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

    req.user = r.rows[0];
    return req.user;
  } catch (e) {
    res.status(500).json({ ok: false, error: "Auth error: " + String(e?.message || e) });
    return null;
  }
}

function roleLower(user) {
  return String(user?.rol || "").toLowerCase();
}

function isAdminOrSuper(user) {
  const r = roleLower(user);
  return r === "admin" || r === "superadmin";
}

function requireAdminOrSuper(req, res) {
  if (!isAdminOrSuper(req.user)) {
    res.status(403).json({ ok: false, error: "No autorizado" });
    return false;
  }
  return true;
}

function requireRole(req, res, allowedRolesLower) {
  const r = roleLower(req.user);
  const allowed = new Set((allowedRolesLower || []).map(x => String(x).toLowerCase()));
  if (!allowed.has(r)) {
    res.status(403).json({ ok: false, error: "No autorizado" });
    return false;
  }
  return true;
}

module.exports = { requireAuth, requireAdminOrSuper, requireRole, isAdminOrSuper };
