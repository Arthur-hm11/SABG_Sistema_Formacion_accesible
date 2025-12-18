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

  // 👀 LOG 1: Ver qué llega exactamente
  console.log("📦 Body recibido (raw):", req.body);
  console.log("📦 Tipo de req.body:", typeof req.body);

  // 🔎 Extraer datos
  const { usuario, institucion, password } = req.body || {};

  // 👀 LOG 2: Ver qué se extrajo
  console.log("📝 Datos extraídos:");
  console.log("  - usuario:", usuario, "(tipo:", typeof usuario, ")");
  console.log("  - institucion:", institucion, "(tipo:", typeof institucion, ")");
  console.log("  - password:", password ? "***" : undefined, "(tipo:", typeof password, ")");

  // 🧹 Normalizar (trim)
  const usuarioLimpio = usuario?.trim();
  const institucionLimpia = institucion?.trim();

  // 👀 LOG 3: Ver después del trim
  console.log("✂️ Datos después de trim:");
  console.log("  - usuarioLimpio:", usuarioLimpio);
  console.log("  - institucionLimpia:", institucionLimpia);
  console.log("  - password existe:", !!password);

  // 🚨 Validación estricta con logs detallados
  if (!usuarioLimpio) {
    console.error("❌ FALTA: usuario");
    return res.status(400).json({
      ok: false,
      error: "Datos incompletos: falta usuario"
    });
  }

  if (!institucionLimpia) {
    console.error("❌ FALTA: institucion");
    return res.status(400).json({
      ok: false,
      error: "Datos incompletos: falta institución"
    });
  }

  if (!password) {
    console.error("❌ FALTA: password");
    return res.status(400).json({
      ok: false,
      error: "Datos incompletos: falta contraseña"
    });
  }

  console.log("✅ Validación OK - Procediendo a guardar...");

  try {
    // 🔐 Hash de contraseña
    const hash = await bcrypt.hash(password, 10);
    console.log("🔐 Hash generado");

    // 📥 Insertar usuario
    await pool.query(
      `INSERT INTO usuarios (usuario, institucion, password_hash)
       VALUES ($1, $2, $3)`,
      [usuarioLimpio, institucionLimpia, hash]
    );

    console.log("✅ Usuario insertado en BD:", usuarioLimpio);

    // ✅ Respuesta OK
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
    console.error("💥 ERROR en BD:", error);
    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor"
    });
  }
}
