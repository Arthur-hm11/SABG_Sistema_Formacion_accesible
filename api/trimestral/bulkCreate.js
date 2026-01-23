const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TABLE_SCHEMA = "public";
const TABLE_NAME = "registros_trimestral";
const TABLE = `${TABLE_SCHEMA}.${TABLE_NAME}`;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || s.toUpperCase() === "NULL") return null;
    return s;
  }
  return v;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error("Body JSON inválido")); }
    });
    req.on("error", reject);
  });
}

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
  cachedCols = r.rows.map(x => x.column_name);
  return cachedCols;
}

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

function calcBatchSize(colCount) {
  const MAX_PARAMS = 60000;
  const safe = Math.max(1, Math.floor(MAX_PARAMS / Math.max(colCount, 1)));
  return Math.max(50, Math.min(400, safe));
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    // 1) Body robusto
    const body = (req.body && typeof req.body === "object") ? req.body : await readJsonBody(req);

    // 2) Acepta {registros:[...]} o {rows:[...]} o [...]
    const rows = Array.isArray(body) ? body : (body.registros || body.rows || []);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No se recibieron registros" });
    }

    // 3) Índice ON CONFLICT
    await ensureUniqueIndex();

    // 4) Columnas reales
    const tableCols = await getTableColumns();
    const tableSet = new Set(tableCols);

    // 5) Detecta columnas del payload y filtra a las que existan
    const incomingKeys = new Set();
    for (const r of rows) if (r && typeof r === "object") Object.keys(r).forEach(k => incomingKeys.add(k));

    if (!incomingKeys.has("curp") || !incomingKeys.has("trimestre")) {
      return res.status(400).json({ ok: false, error: "Faltan columnas obligatorias: curp y/o trimestre" });
    }
    if (!tableSet.has("curp") || !tableSet.has("trimestre")) {
      return res.status(500).json({ ok: false, error: "La tabla no tiene curp/trimestre (estructura distinta)" });
    }

    const cols = Array.from(incomingKeys).filter(c => tableSet.has(c));
    // Forzar orden estable
    const rest = cols.filter(c => c !== "curp" && c !== "trimestre").sort();
    const finalCols = ["curp", "trimestre", ...rest];

    const updatable = finalCols.filter(c => c !== "curp" && c !== "trimestre");
    const setClause = updatable.map(c => `"${c}" = EXCLUDED."${c}"`).join(", ");
    const conflictAction = setClause ? `DO UPDATE SET ${setClause}` : "DO NOTHING";

    // 6) Insert por lotes
    const batchSize = calcBatchSize(finalCols.length);
    let totalAfectados = 0;

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);

      const values = [];
      const placeholders = batch.map((r) => {
        const p = finalCols.map((c) => {
          values.push(norm(r ? r[c] : null));
          return `$${values.length}`;
        });
        return `(${p.join(",")})`;
      });

      const sql = `
        INSERT INTO ${TABLE} (${finalCols.map(c => `"${c}"`).join(",")})
        VALUES ${placeholders.join(",")}
        ON CONFLICT (curp, trimestre) WHERE curp IS NOT NULL
        ${conflictAction};
      `;

      const result = await pool.query(sql, values);
      totalAfectados += result.rowCount;
    }

    return res.status(200).json({
      ok: true,
      tabla: TABLE,
      recibidos: rows.length,
      afectados: totalAfectados,
      columnas_usadas: finalCols
    });

  } catch (e) {
    // OJO: siempre JSON para que NO aparezca el HTML genérico de Vercel
    console.error("bulkCreate fatal:", e);
    return res.status(500).json({
      ok: false,
      error: (e && e.message) ? e.message : "Error interno",
      where: "bulkCreate.js"
    });
  }
};
