import pg from "pg";
const { Pool } = pg;

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  // ===== POST (deleteTest) - solo para limpiar el registro de prueba =====
  if (req.method === 'POST') {
    try {
      let data = '';
      await new Promise((resolve, reject) => {
        req.on('data', (c) => (data += c));
        req.on('end', resolve);
        req.on('error', reject);
      });
      const body = data ? JSON.parse(data) : {};
      const id = Number(body?.id);
      const deleteTest = body?.deleteTest === true;

      if (!deleteTest) {
        return res.status(400).json({ success:false, error:'POST no soportado (falta deleteTest:true)' });
      }
      if (!id) {
        return res.status(400).json({ success:false, error:'Falta id numérico' });
      }

      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 1,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 8000,
      });

      const TABLE = 'public.registros_trimestral';
      const r = await pool.query(
        `DELETE FROM ${TABLE}
       WHERE id = $1
         AND trimestre LIKE 'TEST_%'
       RETURNING id;`,
        [id]
      );

      try { await pool.end(); } catch (_) {}

      return res.status(200).json({
        success:true,
        ok:true,
        deleted: r.rowCount,
        id: (r.rows?.[0]?.id ?? null),
      });
    } catch (e) {
      return res.status(500).json({ success:false, ok:false, error: String(e?.message || e || 'Error') });
    }
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    const dependencia = req.query?.dependencia;

    let query = "SELECT * FROM registros_trimestral ORDER BY created_at DESC";
    const params = [];

    if (dependencia && dependencia !== "null") {
      query =
        "SELECT * FROM registros_trimestral WHERE dependencia ILIKE $1 ORDER BY created_at DESC";
      params.push(`%${dependencia}%`);
    }

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error /api/trimestral/list:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || String(error),
    });
  }
}
