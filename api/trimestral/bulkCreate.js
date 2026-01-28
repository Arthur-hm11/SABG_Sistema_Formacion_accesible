import { Pool } from "pg";

// Pool estable para Vercel (reduce crashes por conexiones)
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000,
});

const TABLE_SCHEMA = "public";
const TABLE_NAME = "registros_trimestral";
const TABLE = `${TABLE_SCHEMA}.${TABLE_NAME}`;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("Body JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || s.toUpperCase() === "NULL") return null;
    return s;
  }
  return v;
}

let cachedTableCols = null;
async function getTableCols() {
  if (cachedTableCols) return cachedTableCols;

  const r = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position;
    `,
    [TABLE_SCHEMA, TABLE_NAME]
  );
  cachedTableCols = r.rows.map((x) => x.column_name);
  return cachedTableCols;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }


  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    // Body robusto (Vercel a veces no parsea req.body)
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : await readJsonBody(req);

    // Acepta: { rows:[...] } o { registros:[...] } o [...]
    const rows = Array.isArray(body) ? body : body.rows || body.registros || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No se recibieron filas" });
    }

    // Columnas reales de la tabla (para NO fallar si el Excel trae extras)
    const tableCols = await getTableCols();
    const tableSet = new Set(tableCols);

    // Columnas que vienen en el Excel
    const incoming = new Set();
    for (const r of rows) {
      if (r && typeof r === "object") Object.keys(r).forEach((k) => incoming.add(k));
    }

    // Solo insertamos columnas que existan en la tabla
    const cols = Array.from(incoming).filter((c) => tableSet.has(c));

    if (cols.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "El archivo no coincide con ninguna columna de la tabla registros_trimestral.",
      });
    }

    // Lotes internos pequeños = más estable
    const BATCH = 80;
    const batches = chunk(rows, BATCH);

    let recibidos = rows.length;
    let insertados = 0;

    for (const b of batches) {
      const values = [];
      const placeholders = b.map((r) => {
        const p = cols.map((c) => {
          values.push(norm(r?.[c])); // si falta dato => NULL
          return `$${values.length}`;
        });
        return `(${p.join(",")})`;
      });

      const sql = `
        INSERT INTO ${TABLE} (${cols.map((c) => `"${c}"`).join(",")})
        VALUES ${placeholders.join(",")}
      `;

      const result = await pool.query(sql, values);
      insertados += result.rowCount;
    }

    return res.status(200).json({
      ok: true,
      recibidos,
      insertados,
      // Nota: insertados == recibidos si no hay errores de BD
      columnas_usadas: cols,
    });

  } catch (e) {
    console.error("bulkCreate fatal:", e);
    // Siempre JSON
    return res.status(500).json({
      ok: false,
      error: e?.message || "Error interno",
      tip: "Revisa que exista public.registros_trimestral y que el Excel traiga columnas compatibles.",
    });
  }
}
