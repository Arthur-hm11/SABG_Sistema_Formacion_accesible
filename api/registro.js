import bcrypt from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { usuario, institucion, password } = req.body;

  if (!usuario || !institucion || !password) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO usuarios (usuario, institucion, password_hash)
       VALUES ($1, $2, $3)`,
      [usuario, institucion, hash]
    );

    return res.status(201).json({
      ok: true,
      message: "Usuario registrado correctamente"
    });

  } catch (error) {
    // 🔐 Usuario duplicado
    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "El usuario ya existe"
      });
    }

    console.error("ERROR REGISTER:", error);

    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor"
    });
  }
}
