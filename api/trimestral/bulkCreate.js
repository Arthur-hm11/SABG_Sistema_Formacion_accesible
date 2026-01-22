// /api/trimestral/bulkCreate.js  (ESM - compatible con tu proyecto)
// Inserción masiva por lotes a: registros_trimestral
// Dedupe profesional: ON CONFLICT DO NOTHING (requiere UNIQUE parcial en BD por (curp,trimestre) WHERE curp IS NOT NULL)
// Reporta errores por fila sin romper la carga.

import { Pool } from "pg";

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

// Normaliza CURP "basura" a NULL para evitar choques y duplicados falsos
function normalizeCurpForDb(curpVal) {
  const s = upperOrNull(curpVal);
  if (!s) return null;

  const bad = new Set(["SIN INFORMACION", "SIN INFORMACIÓN", "N/A", "NA", "NULL", "-", "0"]);
  if (bad.has(s)) return null;

  // CURP debe ser 18 alfanuméricos
  if (s.length !== 18) return null;
  if (!/^[A-Z0-9]{18}$/.test(s)) return null;

  return s;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const rows = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : [];

    if (!rows.length) {
      return res
        .status(400)
        .json({ success: false, message: "No se recibieron registros (rows vacíos)" });
    }

    // ✅ TU TABLA REAL
    const tableName = "registros_trimestral";

    // ✅ TUS COLUMNAS REALES (según tu captura)
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

    // Mapea y normaliza: NULL si viene vacío, CURP limpia
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

      // ✅ clave: curp inválida -> NULL (no choca con unique parcial)
      curp: normalizeCurpForDb(r.curp),

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

    // Filtra filas completamente vacías (evita insertar pura basura)
    const filtered = cleanRows.filter((r) =>
      cols.some((c) => c !== "usuario_registro" && r[c] !== null)
    );

    if (!filtered.length) {
      return res.status(200).json({
        success: true,
        inserted: 0,
        skipped: rows.length,
        received: rows.length,
        processed: 0,
        errors: [],
        errors_count: 0,
      });
    }

    const BATCH = 200; // 100–300 recomendado
    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < filtered.length; i += BATCH) {
      const batch = filtered.slice(i, i + BATCH);

      const values = [];
      const placeholders = batch.map((r, rowIdx) => {
        const base = rowIdx * cols.length;
        cols.forEach((c) => values.push(r[c] ?? null));
        return `(${cols.map((_, colIdx) => `$${base + colIdx + 1}`).join(",")})`;
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
        skipped += batch.length - ins;
      } catch (e) {
        // Si truena un lote, intentamos fila por fila para rescatar lo posible y capturar errores
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
            skipped += 1 - ins1;
          } catch (e2) {
            skipped += 1;
            errors.push({
              message: e2?.message || String(e2),
              curp: r.curp ?? null,
              trimestre: r.trimestre ?? null,
              id_rusp: r.id_rusp ?? null,
              nombre: r.nombre ?? null,
              primer_apellido: r.primer_apellido ?? null,
              segundo_apellido: r.segundo_apellido ?? null,
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
      errors: errors.slice(0, 50), // muestra hasta 50
      errors_count: errors.length,
      note:
        "Para dedupe real, crea UNIQUE parcial: (curp,trimestre) WHERE curp IS NOT NULL. CURP inválida se guarda como NULL.",
    });
  } catch (err) {
    console.error("bulkCreate fatal:", err);
    return res.status(500).json({
      success: false,
      message: "Error del servidor",
      error: err?.message || String(err),
    });
  }
}
