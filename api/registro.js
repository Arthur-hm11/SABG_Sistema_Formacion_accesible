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

  try {
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO usuarios (usuario, institucion, password_hash)
       VALUES ($1,$2,$3)`,
      [usuario, institucion, hash]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Usuario ya existe o error" });
  }
}
