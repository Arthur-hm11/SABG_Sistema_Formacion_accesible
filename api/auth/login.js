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

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Método no permitido' 
    });
  }

  try {
    const { usuario, password } = req.body;

    console.log('🔍 Intento login:', usuario);

    if (!usuario || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Usuario y contraseña requeridos' 
      });
    }

    const result = await pool.query(
      'SELECT * FROM usuarios WHERE UPPER(usuario) = UPPER($1)',
      [usuario]
    );

    console.log('📊 Usuarios encontrados:', result.rows.length);

    if (result.rows.length === 0) {
      console.log('❌ Usuario no encontrado');
      return res.status(401).json({ 
        success: false,
        error: 'Usuario no encontrado' 
      });
    }

    const user = result.rows[0];
    console.log('👤 Usuario:', user.usuario);
    console.log('🔑 Hash en BD:', user.password_hash.substring(0, 20) + '...');

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    console.log('🔐 Contraseña correcta:', passwordMatch);

    if (!passwordMatch) {
      return res.status(401).json({ 
        success: false,
        error: 'Contraseña incorrecta' 
      });
    }

    console.log('✅ Login exitoso');

    return res.status(200).json({
      success: true,
      user: {
        usuario: user.usuario,
        nombre: user.nombre || user.usuario,
        rol: user.rol,
        dependencia: user.dependencia
      }
    });

  } catch (error) {
    console.error('❌ Error login:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Error: ' + error.message
    });
  }
};
