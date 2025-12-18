import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ SOLO acepta POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      ok: false, 
      error: 'Método no permitido. Use POST.' 
    });
  }

  try {
    // ✅ LOG: Ver qué llega del frontend
    console.log('📥 Body recibido:', JSON.stringify(req.body, null, 2));

    // ✅ Extraer datos del body
    const { usuario, institucion, password } = req.body;

    // ✅ LOG: Verificar cada campo
    console.log('🔍 Campos extraídos:', {
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

      console.error('❌ VALIDACIÓN FALLIDA. Campos faltantes:', camposFaltantes);
      
      return res.status(400).json({ 
        ok: false, 
        error: `Datos incompletos. Faltan: ${camposFaltantes.join(', ')}`,
        camposFaltantes
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

    console.log('✅ Validaciones pasadas. Verificando si usuario existe...');

    // ✅ Verificar si el usuario ya existe
    const checkQuery = 'SELECT id FROM usuarios WHERE usuario = $1';
    const checkResult = await pool.query(checkQuery, [usuario]);

    if (checkResult.rows.length > 0) {
      console.log('⚠️ Usuario ya existe:', usuario);
      return res.status(409).json({ 
        ok: false, 
        error: 'El usuario ya está registrado' 
      });
    }

    console.log('✅ Usuario disponible. Hasheando contraseña...');

    // ✅ Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('✅ Contraseña hasheada. Insertando en base de datos...');

    // ✅ Insertar nuevo usuario
    const insertQuery = `
      INSERT INTO usuarios (usuario, institucion, password, rol, created_at)
      VALUES ($1, $2, $3, 'enlace', NOW())
      RETURNING id, usuario, institucion, rol, created_at
    `;

    const insertResult = await pool.query(insertQuery, [
      usuario,
      institucion,
      hashedPassword
    ]);

    const nuevoUsuario = insertResult.rows[0];

    console.log('✅ REGISTRO EXITOSO:', {
      id: nuevoUsuario.id,
      usuario: nuevoUsuario.usuario,
      institucion: nuevoUsuario.institucion,
      rol: nuevoUsuario.rol
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
    console.error('💥 ERROR EN REGISTRO:', error);
    console.error('Stack trace:', error.stack);

    // Errores específicos de PostgreSQL
    if (error.code === '23505') {
      return res.status(409).json({ 
        ok: false, 
        error: 'El usuario ya existe en la base de datos' 
      });
    }

    if (error.code === '42P01') {
      return res.status(500).json({ 
        ok: false, 
        error: 'Error de configuración: tabla usuarios no encontrada' 
      });
    }

    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor al procesar el registro',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
