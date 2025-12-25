cat > api/trimestral/create.js << 'EOF'
const { Pool } = require('pg');

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
    const data = req.body;

    const result = await pool.query(
      `INSERT INTO registros_formacion (
        enlace_nombre, enlace_primer_apellido, enlace_segundo_apellido,
        enlace_correo, enlace_telefono,
        trimestre, id_rusp, primer_apellido, segundo_apellido, nombre,
        curp, nivel_puesto, nivel_tabular, ramo_ur, dependencia,
        correo_institucional, telefono_institucional, nivel_educativo,
        institucion_educativa, modalidad, estado_avance, observaciones,
        usuario_registro, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, NOW()
      ) RETURNING *`,
      [
        data.enlace_nombre, data.enlace_primer_apellido, data.enlace_segundo_apellido,
        data.enlace_correo, data.enlace_telefono,
        data.trimestre, data.id_rusp, data.primer_apellido, data.segundo_apellido, data.nombre,
        data.curp, data.nivel_puesto, data.nivel_tabular, data.ramo_ur, data.dependencia,
        data.correo_institucional, data.telefono_institucional, data.nivel_educativo,
        data.institucion_educativa, data.modalidad, data.estado_avance, data.observaciones,
        data.usuario_registro
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Registro creado exitosamente',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error al crear registro:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Error en el servidor'
    });
  }
};
EOF
