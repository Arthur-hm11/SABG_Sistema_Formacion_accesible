// /api/trimestral/bulkCreate.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function upperOrNull(v) {
  const s = norm(v);
  return s ? s.toUpperCase() : null;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Método no permitido" });

  try {
    const body = req.body || {};
    const rows = Array.isArray(body) ? body : (Array.isArray(body.rows) ? body.rows : []);
    if (!rows.length) return res.status(400).json({ success: false, message: "No se recibieron registros (rows vacíos)" });

    // ✅ TABLA REAL (plural)
    const tableName = "registros_trimestral";

    // ✅ COLUMNAS REALES (según tu captura)
    const cols = [
      "enlace_nombre",
      "enlace_primer_apellido",
      "enlace_segundo_apellido",
      "enlace_correo",
      "enlace_telefono",
      "trimestre",
      "id_rusp",
      "primer_apellido",
      "segundo_apellido",
      "nombre",
      "curp",
      "nivel_puesto",
      "nivel_tabular",
      "ramo_ur",
      "dependencia",
      "correo_institucional",
      "telefono_institucional",
      "nivel_educativo",
      "institucion_educativa",
      "modalidad",
      "estado_avance",
      "observaciones",
      "usuario_registro",
    ];

    const cleanRows = rows.map((r) => ({
      enlace_nombre: norm(r.enlace_nombre),
      enlace_primer_apellido: norm(r.enlace_primer_apellido),
      enlace_segundo_apellido: norm(r.enlace_segundo_apellido),
      enlace_correo: norm(r.enlace_correo),
      enlace_telefono: norm(r.enlace_telefono),

      trimestre: norm(r.trimestre),
      id_rusp: norm(r.id_rusp),
      primer_apellido: norm(r.primer_apellido),
      segundo_apellido: norm(r.segundo_apellido),
      nombre: norm(r.nombre),
      curp: upperOrNull(r.curp),

      nivel_puesto: norm(r.nivel_puesto),
      nivel_tabular: norm(r.nivel_tabular),
      ramo_ur: norm(r.ramo_ur),
      dependencia: norm(r.dependencia),

      correo_institucional: norm(r.correo_institucional),
      telefono_institucional: norm(r.telefono_institucional),
      nivel_educativo: norm(r.nivel_educativo),
      institucion_educativa: norm(r.institucion_educativa),

      modalidad: norm(r.modalidad),
      estado_avance: norm(r.estado_avance),
      observaciones: norm(r.observaciones),

      usuario_registro: norm(r.usuario_registro),
    }));

    // filtra filas totalmente vacías
    const filtered = cleanRows.filter((r) => cols.some((c) => c !== "usuario_registro" && r[c] !== null));
    if (!filtered.length) {
      return res.status(200).json({ success: true, inserted: 0, skipped: rows.length, received: rows.length, processed: 0, errors: [], errors_count: 0 });
    }

    const BATCH = 200;
    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < filtered.length; i += BATCH) {
      const batch = filtered.slice(i, i + BATCH);

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
        const ins = result.rowCount || 0;
        inserted += ins;
        skipped += (batch.length - ins);
      } catch (e) {
        // si truena lote, aislar por fila
        for (const r of batch) {
          try {
            const singleSql = `
              INSERT INTO ${tableName} (${cols.join(",")})
              VALUES (${cols.map((_, idx) => `$${idx + 1}`).join(",")})
              ON CONFLICT DO NOTHING
            `;
            const singleVals = cols.map((c) => r[c] ?? null);
            const singleRes = await pool.query(singleSql, singleVals);
            const ins1 = singleRes.rowCount || 0;
            inserted += ins1;
            skipped += (1 - ins1);
          } catch (e2) {
            skipped += 1;
            errors.push({ message: e2.message, row: r });
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
      errors: errors.slice(0, 30),
      errors_count: errors.length,
    });

  } catch (err) {
    console.error("bulkCreate fatal:", err);
    return res.status(500).json({ success: false, message: "Error del servidor", error: err.message });
  }
};
