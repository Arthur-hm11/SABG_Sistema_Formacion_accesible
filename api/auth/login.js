import { Pool } from "pg";
import bcrypt from "bcrypt";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método no permitido" });
  }

  try {
    const { usuario, password } = req.body || {};
    const usuarioClean = usuario?.trim().toUpperCase();
    const passwordClean = password?.trim();

    if (!usuarioClean || !passwordClean) {
      return res.status(400).json({ success: false, message: "Usuario y contraseña son obligatorios" });
    }

    const result = await pool.query(
      "SELECT id, usuario, nombre, rol, dependencia, password_hash FROM usuarios WHERE UPPER(usuario) = $1",
      [usuarioClean]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Usuario no encontrado" });
    }

    const user = result.rows[0];
    let ok = false;

    // legacy: texto plano
    if (user.password_hash && !user.password_hash.startsWith("$2")) {
      if (passwordClean === user.password_hash.trim()) {
        ok = true;
        const newHash = await bcrypt.hash(passwordClean, 10);
        await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
      }
    } else {
      ok = await bcrypt.compare(passwordClean, user.password_hash || "");
    }

    if (!ok) {
      return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
    }

    return res.status(200).json({
      success: true,
      usuario: user.usuario,
      nombre: user.nombre,
      rol: user.rol,
      dependencia: user.dependencia,
    });
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
}
