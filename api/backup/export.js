import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";

export default async (req, res) => {
  const pre = applyCors(req, res);
  if (pre) return;
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdminSession(session)) return res.status(403).json({ error: 'No autorizado' });

  try {
    // Obtener todos los registros
    const result = await pool.query(`
      SELECT * FROM registros_trimestral
      ORDER BY created_at DESC
    `);

    // Obtener usuarios sin contraseñas ni hashes
    const usuarios = await pool.query(`
      SELECT id, usuario, nombre, primer_apellido, segundo_apellido,
             correo, curp, dependencia, rol, created_at 
      FROM usuarios 
      ORDER BY created_at DESC
    `);

    const backup = {
      fecha_backup: new Date().toISOString(),
      total_registros: result.rows.length,
      total_usuarios: usuarios.rows.length,
      registros: result.rows,
      usuarios: usuarios.rows
    };

    // Devolver como JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=backup_sabg_${new Date().toISOString().split('T')[0]}.json`);
    
    return res.status(200).json(backup);

  } catch (error) {
    console.error('Error al generar backup:', error);
    return res.status(500).json({ error: 'Error al generar backup' });
  }
};
