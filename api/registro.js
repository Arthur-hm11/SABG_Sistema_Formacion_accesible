import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ CONFIGURACIÓN CRÍTICA PARA VERCEL
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {
  // ✅ Headers CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ✅ Manejar preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ✅ SOLO acepta POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      ok: false, 
      error: 'Método no permitido. Use POST.' 
    });
  }

  try {
    // ✅ LOG COMPLETO del request
    console.log('📥 =================================');
    console.log('📥 METHOD:', req.method);
    console.log('📥 HEADERS:', JSON.stringify(req.headers, null, 2));
    console.log('📥 RAW BODY:', req.body);
    console.log('📥 BODY TYPE:', typeof req.body);
    console.log('📥 =================================');

    // ✅ Parsear body si viene como string
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
        console.log('✅ Body parseado desde string:', body);
      } catch (parseError) {
        console.error('❌ Error al parsear body string:', parseError);
        return res.status(400).json({
          ok: false,
          error: 'Formato de datos inválido'
        });
      }
    }

    // ✅ Extraer datos
    const { usuario, institucion, password } = body || {};

    console.log('🔍 Datos extraídos:', {
      usuario: usuario || '❌ UNDEFINED',
      institucion: institucion || '❌ UNDEFINED',
      password: password ? '✅ Presente' : '❌ UNDEFINED'
    });

    // ✅ Validación estricta
    if (!usuario || !institucion || !password) {
      const camposFaltantes = [];
      if (!usuario) camposFaltantes.push('usuario');
      if (!institucion) camposFaltantes.push('institucion');
      if (!password) camposFaltantes.push('password');

      console.error('❌ Validación fallida:', camposFaltantes);
      
      return res.status(400).json({ 
        ok: false, 
        error: `Datos incompletos. Faltan: ${camposFaltantes.join(', ')}`,
        camposFaltantes,
        bodyRecibido: body
      });
    }

    // ✅ Validación de longitud
    if (usuario.trim().length < 3) {
      return res.status(400).json({ 
        ok: false, 
        error: 'El usuario debe tener al menos 3 caracteres' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        ok: false, 
        error: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    console.log('✅ Validaciones OK. Verificando existencia...');

    // ✅ Verificar si el usuario ya existe
    const checkQuery = 'SELECT id FROM usuarios WHERE usuario = $1';
    const checkResult = await pool.query(checkQuery, [usuario.trim()]);

    if (checkResult.rows.length > 0) {
      console.log('⚠️ Usuario ya existe:', usuario);
      return res.status(409).json({ 
        ok: false, 
        error: 'El usuario ya está registrado' 
      });
    }

    console.log('✅ Usuario disponible. Hasheando password...');

    // ✅ Hashear password
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('✅ Password hasheado. Insertando...');

    // ✅ Insertar usuario
    const insertQuery = `
      INSERT INTO usuarios (usuario, institucion, password, rol, created_at)
      VALUES ($1, $2, $3, 'enlace', NOW())
      RETURNING id, usuario, institucion, rol, created_at
    `;

    const insertResult = await pool.query(insertQuery, [
      usuario.trim(),
      institucion.trim(),
      hashedPassword
    ]);

    const nuevoUsuario = insertResult.rows[0];

    console.log('✅ ¡REGISTRO EXITOSO!', {
      id: nuevoUsuario.id,
      usuario: nuevoUsuario.usuario
    });

    // ✅ Respuesta exitosa
    return res.status(201).json({
      ok: true,
      mensaje: 'Usuario registrado correctamente',
      usuario: {
        id: nuevoUsuario.id,
        usuario: nuevoUsuario.usuario,
        institucion: nuevoUsuario.institucion,
        rol: nuevoUsuario.rol,
        created_at: nuevoUsuario.created_at
      }
    });

  } catch (error) {
    console.error('💥 ERROR CRÍTICO:', error);
    console.error('Stack:', error.stack);

    // Errores PostgreSQL
    if (error.code === '23505') {
      return res.status(409).json({ 
        ok: false, 
        error: 'El usuario ya existe' 
      });
    }

    if (error.code === '42P01') {
      return res.status(500).json({ 
        ok: false, 
        error: 'Tabla usuarios no encontrada' 
      });
    }

    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
