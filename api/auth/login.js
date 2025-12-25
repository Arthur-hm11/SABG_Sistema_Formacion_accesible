const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { usuario, password } = req.body;

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

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: 'Credenciales incorrectas' 
      });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ 
        success: false,
        error: 'Credenciales incorrectas' 
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        usuario: user.usuario,
        nombre: user.nombre || user.usuario,
        rol: user.rol,
        dependencia: user.institucion
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Error en el servidor'
    });
  }
};
