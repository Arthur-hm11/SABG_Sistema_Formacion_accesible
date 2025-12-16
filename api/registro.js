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
    const data = req.body;

    await pool.query(
      "INSERT INTO registros_formacion (datos) VALUES ($1)",
      [data]
    );

    res.status(200).json({
      ok: true,
      mensaje: "Registro guardado correctamente"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: "Error al guardar"
    });
  }
}
