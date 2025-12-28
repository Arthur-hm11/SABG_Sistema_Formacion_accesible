const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    // 🔹 1. Leer y normalizar datos
    const { usuario, password } = req.body || {};

    const usuarioClean = String(usuario || '').trim().toUpperCase();
    const passwordClean = String(password || '').trim();

    if (!usuarioClean || !passwordClean) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y contraseña son obligatorios'
      });
    }

    // 🔹 2. Buscar usuario (case-insensitive)
    const result = await pool.query(
      `SELECT id, usuario, password_hash, rol, nombre, dependencia
       FROM usuarios
       WHERE UPPER(usuario) = $1
       LIMIT 1`,
      [usuarioClean]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    const user = result.rows[0];
    let passwordMatch = false;

    // 🔹 3. Comparación en texto plano (legacy)
    if (
      user.password_hash &&
      !user.password_hash.startsWith('$2b$') &&
      passwordClean === user.password_hash.trim()
    ) {
      passwordMatch = true;

      // 🔁 Migrar automáticamente a bcrypt
      const newHash = await bcrypt.hash(passwordClean, 10);
      await pool.query(
        'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
        [newHash, user.id]
      );

      console.log(`🔐 Password migrado a bcrypt para ${user.usuario}`);
    }

    // 🔹 4. Comparación bcrypt
    if (
      !passwordMatch &&
      user.password_hash &&
      user.password_hash.startsWith('$2b$')
    ) {
      passwordMatch = await bcrypt.compare(passwordClean, user.password_hash);
    }

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Contraseña incorrecta'
      });
    }

    // 🔹 5. VALIDACIÓN DE ROL (CLAVE DEL PROBLEMA)
    if (!user.rol) {
      return res.status(500).json({
        success: false,
        error: 'El usuario no tiene rol asignado en la base de datos'
      });
    }

    // 🔹 6. RESPUESTA FINAL (EL FRONTEND OBEDECE ESTO)
    return res.status(200).json({
      success: true,
      usuario: {
        usuario: user.usuario,
        nombre: user.nombre,
        rol: user.rol,              // ← AQUÍ YA NO FALLA
        dependencia: user.dependencia
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);

    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
};
