import bcrypt from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // 🔒 Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido"
    });
  }

  // 👀 LOG DE DEPURACIÓN - Ver qué llega
  console.log("📦 Body recibido:", req.body);
  console.log("📦 Headers:", req.headers);

  // 🔎 Extraer datos
  const { usuario, institucion, password } = req.body || {};

  // 👀 LOG - Ver qué se extrajo
  console.log("📝 Datos extraídos:", { 
    usuario, 
    institucion, 
    password: password ? "***" : undefined 
  });

  // 🧹 Normalizar
  const usuarioLimpio = usuario?.trim();
  const institucionLimpia = institucion?.trim();

  // 👀 LOG - Ver después del trim
  console.log("✂️ Datos normalizados:", { 
    usuarioLimpio, 
    institucionLimpia, 
    password: password ? "***" : undefined 
  });

  // 🚨 Validación estricta
  if (!usuarioLimpio || !institucionLimpia || !password) {
    console.error("❌ VALIDACIÓN FALLÓ - Datos incompletos");
    console.error("❌ usuarioLimpio:", usuarioLimpio);
    console.error("❌ institucionLimpia:", institucionLimpia);
    console.error("❌ password:", password ? "existe" : "NO EXISTE");
    
    return res.status(400).json({
      ok: false,
      error: "Datos incompletos"
    });
  }

  try {
    // 🔐 Hash de contraseña
    const hash = await bcrypt.hash(password, 10);

    // 📥 Insertar usuario
    await pool.query(
      `INSERT INTO usuarios (usuario, institucion, password_hash)
       VALUES ($1, $2, $3)`,
      [usuarioLimpio, institucionLimpia, hash]
    );

    // ✅ Respuesta OK
    console.log("✅ Usuario registrado exitosamente:", usuarioLimpio);
    return res.status(201).json({
      ok: true,
      message: "Usuario registrado correctamente"
    });

  } catch (error) {
    // 🚫 Usuario duplicado
    if (error.code === "23505") {
      console.error("⚠️ Usuario duplicado:", usuarioLimpio);
      return res.status(409).json({
        ok: false,
        error: "El usuario ya existe"
      });
    }

    // ❌ Error real
    console.error("💥 ERROR /api/registro:", error);
    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor"
    });
  }
}
