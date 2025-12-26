const { Pool } = require('pg');
const bcrypt = require('bcrypt');

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
    let passwordMatch = false;

    // INTENTO 1: Comparar directo (texto plano)
    if (passwordClean === user.password_hash.trim()) {
      passwordMatch = true;
      
      // Si coincide en texto plano, convertir a hash bcrypt automáticamente
      if (!user.password_hash.startsWith('$2b$')) {
        const newHash = await bcrypt.hash(passwordClean, 10);
        await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
        console.log(`✅ Hash auto-generado para usuario ${user.usuario}`);
      }
    }
    
    // INTENTO 2: Comparar con bcrypt (si tiene formato $2b$)
    if (!passwordMatch && user.password_hash.startsWith('$2b$')) {
      try {
        passwordMatch = await bcrypt.compare(passwordClean, user.password_hash);
      } catch (e) {
        console.log('Error bcrypt compare:', e);
      }
    }

    if (!passwordMatch) {
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
