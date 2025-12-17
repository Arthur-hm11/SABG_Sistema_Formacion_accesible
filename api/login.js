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

  const { usuario, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM usuarios WHERE usuario = $1`,
      [usuario]
    );

    if (result.rowCount === 0) {
      return res.json({ ok: false, message: "Usuario no encontrado" });
    }

    const user = result.rows[0];
    const valido = await bcrypt.compare(password, user.password_hash);

    await pool.query(
      `INSERT INTO login_logs (usuario, institucion, exito, navegador)
       VALUES ($1,$2,$3,$4)`,
      [
        usuario,
        user.institucion,
        valido,
        req.headers["user-agent"]
      ]
    );

    if (!valido) {
      return res.json({ ok: false, message: "Contraseña incorrecta" });
    }

    res.json({
      ok: true,
      usuario: user.usuario,
      institucion: user.institucion,
      rol: user.rol
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error de login" });
  }
}
