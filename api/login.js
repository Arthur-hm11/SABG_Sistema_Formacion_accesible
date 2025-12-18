import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ ok: false, message: "Datos incompletos" });
  }

  try {
    // 1️⃣ Buscar usuario
    const result = await pool.query(
      `SELECT * FROM usuarios WHERE usuario = $1`,
      [usuario]
    );

    if (result.rowCount === 0) {
      return res.json({ ok: false, message: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    // 2️⃣ Validar contraseña
    const valido = await bcrypt.compare(password, user.password_hash);

    // 3️⃣ Registrar intento de login
    await pool.query(
      `INSERT INTO login_logs (usuario, institucion, exito, navegador)
       VALUES ($1, $2, $3, $4)`,
      [
        user.usuario,
        user.institucion,
        valido,
        req.headers["user-agent"]
      ]
    );

    if (!valido) {
      return res.json({ ok: false, message: "Contraseña incorrecta" });
    }

    // 4️⃣ Generar JWT
    const token = jwt.sign(
      {
        id: user.id,
        usuario: user.usuario,
        institucion: user.institucion,
        rol: user.rol || "usuario"
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    // 5️⃣ Respuesta final
    return res.json({
      ok: true,
      message: "Login correcto",
      token
    });

  } catch (error) {
    console.error("Error login:", error);
    return res.status(500).json({ ok: false, error: "Error de servidor" });
  }
}
