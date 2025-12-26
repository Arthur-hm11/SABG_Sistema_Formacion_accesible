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
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método no permitido' });

  try {
    const { 
      curp, 
      nombre, 
      primer_apellido, 
      segundo_apellido, 
      correo, 
      dependencia, 
      password 
    } = req.body;

    // Validaciones
    if (!curp || !nombre || !primer_apellido || !segundo_apellido || !correo || !dependencia || !password) {
      return res.status(400).json({ success: false, error: 'Todos los campos son requeridos' });
    }

    if (curp.length !== 18) {
      return res.status(400).json({ success: false, error: 'CURP debe tener 18 caracteres' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Verificar si el CURP ya existe
    const existeCURP = await pool.query('SELECT * FROM usuarios WHERE curp = $1', [curp]);
    if (existeCURP.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'El CURP ya está registrado' });
    }

    // Verificar si el correo ya existe
    const existeCorreo = await pool.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);
    if (existeCorreo.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'El correo ya está registrado' });
    }

    // Generar usuario automático (primeras 4 letras del CURP)
    const usuario = curp.substring(0, 4).toUpperCase();

    // Insertar usuario
    await pool.query(
      `INSERT INTO usuarios (
        usuario, password_hash, nombre, primer_apellido, segundo_apellido, 
        correo, curp, dependencia, rol
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [usuario, password, nombre, primer_apellido, segundo_apellido, correo, curp, dependencia, 'enlace']
    );

    return res.status(201).json({ 
      success: true, 
      message: 'Usuario registrado exitosamente',
      usuario: usuario
    });

  } catch (error) {
    console.error('Error registro:', error);
    return res.status(500).json({ success: false, error: 'Error en el servidor' });
  }
};
