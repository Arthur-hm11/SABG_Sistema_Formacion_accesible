const { requireAuth } = require("../_lib/auth");
import pool from "../_lib/db.js";
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // incluye Authorization por si luego mandas token, y Accept por compatibilidad
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();
  

    const user = await requireAuth(req, res, pool);
    if (!user) return;

if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    const body = req.body || {};

    // Acepta varios nombres de campos (por compatibilidad con lo que ya tengas en el HTML)
    const usuario =
      (body.usuario || body.username || body.user || null)?.toString().trim() || null;

    const accion =
      (body.accion || body.action || body.event || null)?.toString().trim() || null;

    const modulo =
      (body.modulo || body.module || body.entity || null)?.toString().trim() || null;

    const detalle = body.detalle ?? body.details ?? body.data ?? null;

    const ip =
      (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) || null;

    const user_agent = req.headers['user-agent']?.toString() || null;

    // Si NO mandan nada útil, no rompemos: respondemos OK para evitar ruido en consola
    if (!usuario && !accion && !modulo && !detalle) {
      return res.status(200).json({ success: true, skipped: true });
    }

    // Inserta en audit_logs (si existe). Si no existe, no tiramos el sistema.
    try {
      await pool.query(
        `
        INSERT INTO audit_logs (usuario, accion, modulo, detalle, ip, user_agent, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [
          usuario,
          accion,
          modulo,
          detalle ? JSON.stringify(detalle) : null,
          ip,
          user_agent
        ]
      );
    } catch (e) {
      // Si la tabla no existe o el esquema no coincide, no tumbamos la app
      // (así desaparece el 404 y no afecta UX)
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Error del servidor' });
  }
}