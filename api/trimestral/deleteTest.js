import { Pool } from "pg";
import { applyCors } from "../_lib/cors.js";

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000,
});

const TABLE = "public.registros_trimestral";

function setCors(res) {
  const pre = applyCors(req, res);
  if (pre) return;
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error("Body JSON inválido")); }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Método no permitido" });

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : await readJsonBody(req);
    const id = Number(body?.id);
    if (!id) return res.status(400).json({ ok:false, error:"Falta id numérico" });

    const r = await pool.query(
      `DELETE FROM ${TABLE}
       WHERE id = $1
         AND trimestre = 'TEST_TERMINAL'
         AND primer_apellido = 'PRUEBA'
         AND nombre = 'TERMINAL'
         AND usuario_registro = 'Terminal'
       RETURNING id;`,
      [id]
    );

    return res.status(200).json({ ok:true, deleted: r.rowCount, id: (r.rows?.[0]?.id ?? null) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || "Error interno" });
  }
}
