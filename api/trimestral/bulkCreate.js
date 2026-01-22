// /api/trimestral/bulkCreate.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Convierte "" => NULL, deja strings limpias
function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Normalizaciones suaves (no rompen nada)
function toUpperOrNull(v) {
  const s = norm(v);
  return s ? s.toUpperCase() : null;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    // Acepta: { rows: [...] } o directamente [...]
    const rows = Array.isArray(body) ? body : (Array.isArray(body.rows) ? body.rows : []);

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "No se recibieron registros (rows vacíos)" });
    }

    // OJO: usa tu tabla real
    // Por lo que has venido usando en el sistema, lo más probable es:
    // registros_formacion
    const tableName = "registros_formacion";

    // Columnas que tu frontend manda actualmente (según tu idxMap/alias)
    const cols = [
      "trimestre",
      "id_rusp",
      "primer_apellido",
      "segundo_apellido",
      "nombre",
      "curp",
      "correo_institucional",
      "telefono_institucional",
      "nivel_educativo",
      "institucion_educativa",
      "modalidad",
      "estado_avance",
      "observaciones",
      "usuario_registro",
    ];

    // Limpieza y armado de registros
    const cleanRows = rows.map((r) => ({
      trimestre: norm(r.trimestre),
      id_rusp: norm(r.id_rusp),
      primer_apellido: norm(r.primer_apellido),
      segundo_apellido: norm(r.segundo_apellido),
      nombre: norm(r.nombre),
      curp: toUpperOrNull(r.curp),
      correo_institucional: norm(r.correo_institucional),
      telefono_institucional: norm(r.telefono_institucional),
      nivel_educativo: norm(r.nivel_educativo),
      institucion_educativa: norm(r.institucion_educativa),
      modalidad: norm(r.modalidad),
      estado_avance: norm(r.estado_avance),
      observaciones: norm(r.observaciones),
      usuario_registro: norm(r.usuario_registro),
    }));

    // Filtra filas 100% vacías (para no insertar basura)
    const filtered = cleanRows.filter((r) => {
      return cols.some((c) => c !== "usuario_registro" && r[c] !== null);
    });

    if (!filtered.length) {
      return res.status(200).json({ success: true, inserted: 0, skipped: rows.length, errors: [] });
    }

    // Inserción por lote (aquí 200 por batch)
    const BATCH = 200;
    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < filtered.length; i += BATCH) {
      const batch = filtered.slice(i, i + BATCH);

      // placeholders: ($1,$2,...), ($15,$16,...)
      const values = [];
      const placeholders = batch.map((r, rowIdx) => {
        const base = rowIdx * cols.length;
        cols.forEach((c) => values.push(r[c] ?? null));
        const ps = cols.map((_, colIdx) => `$${base + colIdx + 1}`).join(",");
        return `(${ps})`;
      });

      const sql = `
        INSERT INTO ${tableName} (${cols.join(",")})
        VALUES ${placeholders.join(",")}
        ON CONFLICT DO NOTHING
      `;

      try {
        const result = await pool.query(sql, values);

        // rowCount en INSERT con DO NOTHING = cantidad insertada
        inserted += (result.rowCount || 0);

        // lo que no se insertó del batch lo contamos como skipped (por duplicado u otras razones)
        skipped += (batch.length - (result.rowCount || 0));
      } catch (e) {
        // Si falla el batch, NO tumba todo: intentamos fila por fila para aislar errores
        for (const r of batch) {
          try {
            const singleSql = `
              INSERT INTO ${tableName} (${cols.join(",")})
              VALUES (${cols.map((_, idx) => `$${idx + 1}`).join(",")})
              ON CONFLICT DO NOTHING
            `;
            const singleVals = cols.map((c) => r[c] ?? null);
            const singleRes = await pool.query(singleSql, singleVals);
            inserted += (singleRes.rowCount || 0);
            skipped += (1 - (singleRes.rowCount || 0));
          } catch (e2) {
            skipped += 1;
            errors.push({
              message: e2.message,
              row: r,
            });
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      inserted,
      skipped,
      received: rows.length,
      processed: filtered.length,
      errors: errors.slice(0, 30), // no inundar respuesta
      errors_count: errors.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error del servidor", error: err.message });
  }
};
