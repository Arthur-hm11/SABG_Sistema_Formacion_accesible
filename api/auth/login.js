const { Pool } = require('pg');
const bcrypt = require('bcrypt');

/* =========================
   CONEXIÓN A BASE DE DATOS
========================= */
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   HANDLER LOGIN
========================= */
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Método permitido
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    /* =========================
       DATOS DE ENTRADA
    ========================= */
    const { usuario, password } = req.body || {};
    const usuarioClean = usuario?.trim().toUpperCase();
    const passwordClean = password?.trim();

    if (!usuarioClean || !passwordClean) {
      return res.status(400).json({
        success: false,
        error: 'Datos requeridos'
      });
    }

    /* =========================
       BUSCAR USUARIO
    ========================= */
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE UPPER(usuario) = $1',
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

    /* =========================
       INTENTO 1: TEXTO PLANO
    ========================= */
    if (
      user.password_hash &&
      !user.password_hash.startsWith('$2b$') &&
      passwordClean === user.password_hash.trim()
    ) {
      passwordMatch = true;

      // Convertir a bcrypt automáticamente
      const newHash = await bcrypt.hash(passwordClean, 10);
      await pool.query(
        'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
        [newHash, user.id]
      );

      console.log(`✅ Hash auto-generado para usuario ${user.usuario}`);
    }

    /* =========================
       INTENTO 2: BCRYPT
    ========================= */
    if (!passwordMatch && user.password_hash?.startsWith('$2b$')) {
      try {
        passwordMatch = await bcrypt.compare(passwordClean, user.password_hash);
      } catch (err) {
        console.error('Error bcrypt compare:', err);
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Contraseña incorrecta'
      });
    }

    /* =========================
       LOGIN EXITOSO
    ========================= */
    return res.status(200).json({
      success: true,
      usuario: user.usuario,
      nombre: user.nombre,
      rol: user.rol,
      dependencia: user.dependencia
    });

  } catch (error) {
    console.error('Error login:', error);
    return res.status(500).json({
      success: false,
      error: 'Error del servidor'
    });
  }
};
