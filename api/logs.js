import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  const {
    tipo,
    usuario,
    exito,
    mensaje,
    momento
  } = req.body || {};

  if (!tipo || !usuario) {
    return res.status(400).json({ ok: false });
  }

  try {
    await pool.query(
      `
      INSERT INTO registros_formacion
      (tipo, usuario, exito, mensaje, created_at)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        tipo,
        usuario,
        exito ?? null,
        mensaje ?? null,
        momento ? new Date(momento) : new Date()
      ]
    );

    return res.json({ ok: true });

  } catch (error) {
    console.error("ERROR LOG:", error);
    return res.status(500).json({ ok: false });
  }
}

