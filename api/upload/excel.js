import { applyCors } from '../_lib/cors.js';
import { readSabgSession, isAdminSession } from '../_lib/session.js';

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método no permitido' });
  }

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!isAdminSession(session)) {
    return res.status(403).json({ success: false, message: 'No autorizado' });
  }

  return res.status(410).json({
    success: false,
    message: 'Carga Excel directa deshabilitada por seguridad. Use la carga CSV del sistema SABG.'
  });
}
