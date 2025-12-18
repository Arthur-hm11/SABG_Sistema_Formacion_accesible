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
    momento,
    pagina,
    navegador
  } = req.body || {};

  try {
    await pool.query(
      `
      INSERT INTO registros_formacion
      (tipo, usuario, exito, mensaje, momento, pagina, navegador)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [tipo, usuario, exito, mensaje, momento, pagina, navegador]
    );

    return res.json({ ok: true });

  } catch (error) {
    console.error("ERROR /api/logs:", error);
    return res.status(500).json({ ok: false });
  }
}
