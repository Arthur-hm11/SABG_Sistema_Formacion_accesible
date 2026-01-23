const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TABLE = "public.registros_trimestral";

// Se ejecuta una sola vez por instancia (serverless)
let indexEnsured = false;
async function ensureUniqueIndex() {
  if (indexEnsured) return;

  // Índice UNIQUE parcial para habilitar ON CONFLICT (curp,trimestre)
  const sql = `
    CREATE UNIQUE INDEX IF NOT EXISTS registros_trimestral_curp_trimestre_uq
    ON public.registros_trimestral (curp, trimestre)
    WHERE curp IS NOT NULL;
  `;
  await pool.query(sql);
  indexEnsured = true;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function norm(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || s.toUpperCase() === "NULL") return null;
    return s;
  }
  return v;
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

    // Detecta columnas recibidas (dinámico)
    const incomingKeys = new Set();
    for (const r of rows) if (r && typeof r === "object") Object.keys(r).forEach(k => incomingKeys.add(k));

    // Forzamos que curp y trimestre estén presentes
    if (!incomingKeys.has("curp") || !incomingKeys.has("trimestre")) {
      return res.status(400).json({
        error: "Cada registro debe incluir 'curp' y 'trimestre' (aunque curp pueda ser null).",
      });
    }

    const cols = Array.from(incomingKeys);

    // Construcción parametrizada
    const values = [];
    const placeholders = rows.map((r, i) => {
      const p = cols.map((c) => {
        values.push(norm(r?.[c]));
        return `$${values.length}`;
      });
      return `(${p.join(",")})`;
    });

    // Actualiza todas excepto curp y trimestre
    const updatable = cols.filter(c => c !== "curp" && c !== "trimestre");
    const setClause = updatable.map(c => `"${c}" = EXCLUDED."${c}"`).join(", ");

    const sql = `
      INSERT INTO ${TABLE} (${cols.map(c => `"${c}"`).join(",")})
      VALUES ${placeholders.join(",")}
      ON CONFLICT (curp, trimestre) WHERE curp IS NOT NULL
      ${setClause ? `DO UPDATE SET ${setClause}` : "DO NOTHING"}
      RETURNING curp, trimestre;
    `;

    const result = await pool.query(sql, values);

    return res.status(200).json({
      ok: true,
      tabla: TABLE,
      recibidos: rows.length,
      afectados: result.rowCount, // insertados + actualizados
      ejemplo: result.rows.slice(0, 5),
    });

  } catch (e) {
    console.error("bulkCreate error:", e);
    return res.status(500).json({
      ok: false,
      error: e.message,
      tip: "Asegúrate de que el frontend mande 'curp' y 'trimestre'. Y que la tabla sea public.registros_trimestral.",
    });
  }
};
