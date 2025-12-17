import bcrypt from "bcryptjs";
import { pool } from "./_db.js";

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

    if (!valido) {
      return res.json({ ok: false, message: "Contraseña incorrecta" });
    }

    res.json({
      ok: true,
      message: "Login exitoso",
      usuario: user.usuario,
      institucion: user.institucion
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error de login" });
  }
}
