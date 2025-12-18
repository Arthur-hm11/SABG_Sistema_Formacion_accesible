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

  // 🔎 Extraer datos
  const { usuario, institucion, password } = req.body || {};

  // 🧹 Normalizar
  const usuarioLimpio = usuario?.trim();
  const institucionLimpia = institucion?.trim();

  // 🚨 Validación estricta
  if (!usuarioLimpio || !institucionLimpia || !password) {
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
      `
      INSERT INTO usuarios (usuario, institucion, password_hash)
      VALUES ($1, $2, $3)
      `,
      [usuarioLimpio, institucionLimpia, hash]
    );

    // ✅ Respuesta OK
    return res.status(201).json({
      ok: true,
      message: "Usuario registrado correctamente"
    });

  } catch (error) {

    // 🚫 Usuario duplicado
    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "El usuario ya existe"
      });
    }

    // ❌ Error real
    console.error("ERROR /api/registro:", error);

    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor"
    });
  }
}
