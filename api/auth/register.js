const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { usuario, password } = req.body;

    // Limpiar espacios
    const usuarioClean = usuario?.trim().toUpperCase();
    const passwordClean = password?.trim();

    if (!usuarioClean || !passwordClean) {
      return res.status(400).json({ success: false, error: 'Datos requeridos' });
    }

    const result = await pool.query('SELECT * FROM usuarios WHERE UPPER(usuario) = $1', [usuarioClean]);

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    // Comparación directa (limpiando espacios de ambos lados)
    if (passwordClean !== user.password_hash.trim()) {
      return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }

    return res.status(200).json({
      success: true,
      user: {
        usuario: user.usuario,
        nombre: user.nombre,
        rol: user.rol,
        dependencia: user.dependencia
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ success: false, error: 'Error del servidor' });
  }
};
