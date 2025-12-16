import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { usuario, institucion, exito, navegador } = req.body;

    await pool.query(
      `INSERT INTO login_logs (usuario, institucion, exito, navegador)
       VALUES ($1, $2, $3, $4)`,
      [usuario, institucion, exito, navegador]
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error login:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
