const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TABLE_SCHEMA = "public";
const TABLE_NAME = "registros_trimestral";
const TABLE = `${TABLE_SCHEMA}.${TABLE_NAME}`;

// ====== CORS ======
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ====== Normalización básica ======
function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || s.toUpperCase() === "NULL") return null;
    return s;
  }
  return v;
}

// ====== Asegurar índice único (para ON CONFLICT) ======
let indexEnsured = false;
async function ensureUniqueIndex() {
  if (indexEnsured) return;

  const sql = `
    CREATE UNIQUE INDEX IF NOT EXISTS registros_trimestral_curp_trimestre_uq
    ON public.registros_trimestral (curp, trimestre)
    WHERE curp IS NOT NULL;
  `;
  await pool.query(sql);
  indexEnsured = true;
}

// ====== Traer columnas reales de la tabla y cachearlas ======
let cachedCols = null;
async function getTableColumns() {
  if (cachedCols) return cachedCols;

  const q = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position;
  `;
  const r = await pool.query(q, [TABLE_SCHEMA, TABLE_NAME]);
  cachedCols = r.rows.map((x) => x.column_name);
  return cachedCols;
}

// ====== Inserción por lotes (evita exceder el límite de parámetros) ======
// Postgres: 65535 parámetros máx.  Ajustamos batch dinámico.
function calcBatchSize(colCount) {
  // Dejamos margen y evitamos batch demasiado grande.
  const MAX_PARAMS = 60000;
  const safe = Math.max(1, Math.floor(MAX_PARAMS / Math.max(colCount, 1)));
  return Math.max(50, Math.min(500, safe)); // entre 50 y 500
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    await ensureUniqueIndex();

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // Acepta: { registros: [...] } ó { rows: [...] } ó directamente [...]
    const rows = Array.isArray(body) ? body : (body?.registros || body?.rows || []);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No se recibieron registros." });
    }

    // Columnas reales de la tabla
    const tableCols = await getTableColumns();
    const tableColSet = new Set(tableCols);

    // Detecta columnas recibidas en el payload
    const incomingKeys = new Set();
    for (const r of rows) {
      if (r && typeof r === "object") Object.keys(r).forEach((k) => incomingKeys.add(k));
    }

    // Intersección: SOLO columnas que existan en la tabla (esto evita “column does not exist”)
    const cols = Array.from(incomingKeys).filter((c) => tableColSet.has(c));

    // Asegura que estén en tabla y en payload
    if (!tableColSet.has("curp") || !tableColSet.has("trimestre")) {
      return res.status(500).json({
        error: "La tabla public.registros_trimestral no tiene columnas 'curp' y/o 'trimestre'.",
      });
    }
    if (!incomingKeys.has("curp") || !incomingKeys.has("trimestre")) {
      return res.status(400).json({
        error: "Cada registro debe incluir 'curp' y 'trimestre' (aunque curp pueda ser null).",
      });
    }

    // Forzamos que curp y trimestre SIEMPRE vayan en el insert
    if (!cols.includes("curp")) cols.unshift("curp");
    if (!cols.includes("trimestre")) cols.unshift("trimestre");

    // Mantén orden estable (curp, trimestre, luego el resto)
    const rest = cols.filter((c) => c !== "curp" && c !== "trimestre").sort();
    const finalCols = ["curp", "trimestre", ...rest];

    // SET para update (no toca curp/trimestre)
    const updatable = finalCols.filter((c) => c !== "curp" && c !== "trimestre");
    const setClause = updatable.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
    const conflictAction = setClause ? `DO UPDATE SET ${setClause}` : "DO NOTHING";

    // Procesa en lotes
    const batchSize = calcBatchSize(finalCols.length);
    let totalAfectados = 0;
    const ejemplo = [];

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);

      const values = [];
      const placeholders = batch.map((r) => {
        const p = finalCols.map((c) => {
          values.push(norm(r?.[c]));
          return `$${values.length}`;
        });
        return `(${p.join(",")})`;
      });

      const sql = `
        INSERT INTO ${TABLE} (${finalCols.map((c) => `"${c}"`).join(",")})
        VALUES ${placeholders.join(",")}
        ON CONFLICT (curp, trimestre) WHERE curp IS NOT NULL
        ${conflictAction}
        RETURNING curp, trimestre;
      `;

      const result = await pool.query(sql, values);
      totalAfectados += result.rowCount;

      if (ejemplo.length < 5 && result.rows?.length) {
        ejemplo.push(...result.rows.slice(0, 5 - ejemplo.length));
      }
    }

    return res.status(200).json({
      ok: true,
      tabla: TABLE,
      recibidos: rows.length,
      afectados: totalAfectados, // insertados + actualizados
      columnas_usadas: finalCols,
      ejemplo,
    });

  } catch (e) {
    console.error("bulkCreate error:", e);
    return res.status(500).json({
      ok: false,
      error: e.message,
      tip: "Asegúrate de que tu payload mande 'curp' y 'trimestre'. Este endpoint ya filtra columnas que no existan en la tabla.",
    });
  }
};
