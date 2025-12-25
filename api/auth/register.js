cat > api/auth/register.js << 'EOF'
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
    const { usuario, password, institucion } = req.body;

    if (!usuario || !password || !institucion) {
      return res.status(400).json({ 
        success: false,
        error: 'Todos los campos son requeridos' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    const existente = await pool.query(
      'SELECT usuario FROM usuarios WHERE UPPER(usuario) = UPPER($1)',
      [usuario]
    );

    if (existente.rows.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'El usuario ya existe' 
      });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      `INSERT INTO usuarios (usuario, password_hash, rol, institucion, nombre, created_at) 
       VALUES ($1, $2, $3, $4, $5, NOW()) 
       RETURNING usuario, nombre, rol, institucion`,
      [usuario.toUpperCase(), passwordHash, 'enlace', institucion, usuario]
    );

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Error en registro:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Error en el servidor'
    });
  }
};
EOF