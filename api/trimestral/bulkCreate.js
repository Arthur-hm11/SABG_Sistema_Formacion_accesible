const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TABLE = "public.registros_trimestral";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error("JSON inválido")); }
    });
    req.on("error", reject);
  });
}

let cachedCols = null;
async function getCols() {
  if (cachedCols) return cachedCols;
  const r = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='registros_trimestral'
    ORDER BY ordinal_position
  `);
  cachedCols = r.rows.map(x => x.column_name);
  return cachedCols;
}

let ensured = false;
async function ensureIndex() {
  if (ensured) return;
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS registros_trimestral_curp_trimestre_uq
    ON public.registros_trimestral (curp, trimestre)
    WHERE curp IS NOT NULL;
  `);
  ensured = true;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : await readJson(req);
    const rows = Array.isArray(body) ? body : (body.registros || body.rows || []);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: "No se recibieron registros" });
    }

    await ensureIndex();

    const tableCols = await getCols();
    const tableSet = new Set(tableCols);

    // Detecta columnas del payload y filtra a las que existan
    const incoming = new Set();
    for (const r of rows) if (r && typeof r === "object") Object.keys(r).forEach(k => incoming.add(k));

    if (!incoming.has("curp") || !incoming.has("trimestre")) {
      return res.status(400).json({ ok: false, error: "Faltan columnas obligatorias: curp y trimestre" });
    }
    if (!tableSet.has("curp") || !tableSet.has("trimestre")) {
      return res.status(500).json({ ok: false, error: "La tabla no tiene curp/trimestre" });
    }

    const usable = Array.from(incoming).filter(c => tableSet.has(c));
    const rest = usable.filter(c => c !== "curp" && c !== "trimestre").sort();
    const cols = ["curp", "trimestre", ...rest];

    const updatable = cols.filter(c => c !== "curp" && c !== "trimestre");
    const setClause = updatable.map(c => `"${c}"=EXCLUDED."${c}"`).join(", ");
    const conflictAction = setClause ? `DO UPDATE SET ${setClause}` : "DO NOTHING";

    // 👇 Lotes pequeños = estabilidad en Vercel
    const batches = chunk(rows, 80);

    let afectados = 0;
    let errores = 0;

    for (const b of batches) {
      const values = [];
      const placeholders = b.map(r => {
        const p = cols.map(c => {
          values.push(norm(r?.[c]));
          return `$${values.length}`;
        });
        return `(${p.join(",")})`;
      });

      const sql = `
        INSERT INTO ${TABLE} (${cols.map(c => `"${c}"`).join(",")})
        VALUES ${placeholders.join(",")}
        ON CONFLICT (curp, trimestre) WHERE curp IS NOT NULL
        ${conflictAction};
      `;

      try {
        const r = await pool.query(sql, values);
        afectados += r.rowCount;
      } catch (e) {
        // si un lote falla, no tumbes todo: cuenta error y sigue
        console.error("batch failed:", e.message);
        errores += b.length;
      }
    }

    return res.status(200).json({
      ok: true,
      recibidos: rows.length,
      afectados,
      errores,
      columnas_usadas: cols
    });

  } catch (e) {
    console.error("bulkCreate fatal:", e);
    return res.status(500).json({ ok: false, error: e.message || "Error interno" });
  }
};
