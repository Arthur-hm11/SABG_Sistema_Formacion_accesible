// /api/bulkCreate.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function norm(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function isValidCURP(curp) {
  const c = norm(curp).toUpperCase();
  // patrón común CURP (suficiente para clasificar válida vs pendiente)
  return /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(c);
}

async function getTableColumns(client, tableName) {
  const q = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
  `;
  const r = await client.query(q, [tableName]);
  return new Set(r.rows.map((x) => x.column_name));
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  try {
    const body = req.body || {};
    // Soportar ambas formas: { rows: [...] } o directamente [...]
    const rows = Array.isArray(body) ? body : body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No se recibieron filas (rows)" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Cambia aquí si tu tabla se llama diferente:
      const TABLE = "registros_formacion";

      const cols = await getTableColumns(client, TABLE);

      // Asegurar columna estatus_curp (si no existe, no se usará)
      const hasEstatusCurp = cols.has("estatus_curp");
      const hasCurp = cols.has("curp");
      const hasTrimestre = cols.has("trimestre");

      if (!hasCurp) {
        throw new Error(
          "La tabla no tiene columna 'curp'. Ajusta TABLE o tu esquema."
        );
      }
      if (!hasTrimestre) {
        throw new Error(
          "La tabla no tiene columna 'trimestre'. Ajusta TABLE o el nombre de columna."
        );
      }

      // Métricas
      const recibidos = rows.length;
      let insertados = 0;
      let duplicados = 0;
      let curpInvalidaONull = 0;
      let filasVacias = 0;
      let errores = 0;

      // Helper: decide si una fila está vacía (solo espacios)
      function rowHasAnyValue(obj) {
        if (!obj || typeof obj !== "object") return false;
        return Object.values(obj).some((v) => norm(v) !== "");
      }

      for (const r of rows) {
        if (!rowHasAnyValue(r)) {
          filasVacias++;
          continue;
        }

        // CURP: válida => guarda; inválida/vacía => NULL y PENDIENTE
        const curpRaw = norm(r.curp).toUpperCase();
        const curpOk = isValidCURP(curpRaw);
        const curpFinal = curpOk ? curpRaw : null;

        if (!curpOk) curpInvalidaONull++;

        // Construir objeto "a insertar" con intersección de columnas existentes
        // Copia todas las keys del row que existan como columnas.
        // Normaliza: strings -> trim, vacíos -> null
        const insertObj = {};
        for (const [k, v] of Object.entries(r)) {
          const key = String(k).trim();
          if (!cols.has(key)) continue;

          // curp la controlamos nosotros:
          if (key === "curp") continue;

          const value = norm(v);
          insertObj[key] = value === "" ? null : value;
        }

        // Fuerza trimestre y curp
        insertObj.trimestre = norm(r.trimestre) === "" ? null : norm(r.trimestre);
        insertObj.curp = curpFinal;

        // estatus_curp si existe la columna
        if (hasEstatusCurp) {
          insertObj.estatus_curp = curpOk ? "VALIDA" : "PENDIENTE";
        }

        // Si por alguna razón no viene trimestre, no intentes insertar
        if (!insertObj.trimestre) {
          // se considera fila vacía/descartada por regla
          filasVacias++;
          continue;
        }

        // Armar INSERT dinámico
        const keys = Object.keys(insertObj);
        const placeholders = keys.map((_, i) => `$${i + 1}`);
        const values = keys.map((k) => insertObj[k]);

        // ON CONFLICT: depende de tu índice único parcial (curp,trimestre) WHERE curp IS NOT NULL
        // Si tu índice está bien, DO NOTHING omitirá duplicados cuando curp NO NULL
        const q = `
          INSERT INTO ${TABLE} (${keys.join(", ")})
          VALUES (${placeholders.join(", ")})
          ON CONFLICT (curp, trimestre) DO NOTHING
          RETURNING 1
        `;

        const ins = await client.query(q, values);

        if (ins.rowCount === 1) insertados++;
        else duplicados++;
      }

      await client.query("COMMIT");

      return res.status(200).json({
        ok: true,
        recibidos,
        procesados: recibidos - filasVacias,
        insertados,
        duplicados_omitidos: duplicados,
        curp_invalida_o_null: curpInvalidaONull,
        filas_vacias_descartadas: filasVacias,
        errores,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Error en carga masiva",
      detail: err.message,
    });
  }
};
