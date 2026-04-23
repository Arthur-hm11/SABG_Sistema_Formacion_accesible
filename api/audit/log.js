import { applyCors } from '../_lib/cors.js';
import { readSabgSession } from '../_lib/session.js';
import pool from '../_lib/db.js';

function clip(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function safeJson(value, max = 4000) {
  if (value === undefined || value === null) return null;
  const raw = JSON.stringify(value);
  if (raw.length <= max) return raw;
  return JSON.stringify({ truncated: true, preview: raw.slice(0, max) });
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // incluye Authorization por si luego mandas token, y Accept por compatibilidad
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }

  try {
    const body = req.body || {};

    // Acepta varios nombres de campos (por compatibilidad con lo que ya tengas en el HTML)
    const usuario = clip(session.usuario || body.usuario || body.username || body.user, 120);

    const accion = clip(body.accion || body.action || body.event, 120);

    const modulo = clip(body.modulo || body.module || body.entity, 120);

    const detalle = body.detalle ?? body.details ?? body.data ?? null;

    const ip = clip(req.headers['x-forwarded-for']?.toString().split(',')[0], 80);

    const user_agent = clip(req.headers['user-agent'], 300);

    // Si NO mandan nada útil, no rompemos: respondemos OK para evitar ruido en consola
    if (!accion && !modulo && !detalle) {
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
          safeJson(detalle),
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
