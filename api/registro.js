import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    // 🔴 FORZAMOS PARSEO DEL BODY
    let body = req.body;

    if (!body || typeof body !== "object") {
      return res.status(400).json({
        error: "Body inválido",
        recibido: body
      });
    }

    await pool.query(
      `INSERT INTO registros_formacion (datos)
       VALUES ($1)`,
      [body]
    );

    return res.status(200).json({
      ok: true,
      mensaje: "Registro guardado correctamente"
    });

  } catch (error) {
    console.error("ERROR BACKEND:", error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

