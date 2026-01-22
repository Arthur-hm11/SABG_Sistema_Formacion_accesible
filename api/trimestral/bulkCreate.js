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

// Recorta strings para evitar errores por longitud (sin romper nada)
function clip(v, max) {
  const s = norm(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// Normaliza CURP a algo seguro (varchar 18). Si no cuadra, se va a NULL.
function normalizeCurpForDb(curpVal) {
  const s = upperOrNull(curpVal);
  if (!s) return null;

  const bad = new Set([
    "SIN INFORMACION",
    "SIN INFORMACIÓN",
    "N/A",
    "NO APLICA",
    "NA",
    "NULL",
    "-",
    "0",
  ]);
  if (bad.has(s)) return null;

  const compact = s.replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 18) return null;
  if (!/^[A-Z0-9]{18}$/.test(compact)) return null;

  return compact;
}

// ✅ Ajuste clave: SOLO descarta si ABSOLUTAMENTE TODO viene vacío.
// Esto evita perder filas que traen solo enlace_* u otros campos.
function isTrulyEmptyRow(r) {
  const keys = [
    // enlace
    "enlace_nombre",
    "enlace_primer_apellido",
    "enlace_segundo_apellido",
    "enlace_correo",
    "enlace_telefono",

    // registro
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

  return !keys.some((k) => {
    const v = r?.[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método no permitido" });
  }

  const report = {
    received: 0,
    empty_discarded: 0,
    processed: 0,
    curp_invalid_to_null: 0,
    inserted: 0,
    duplicates_omitted: 0,
    errors_count: 0,
    errors: [],
  };

  try {
    const body = req.body || {};
    const rows = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : [];
    report.received = rows.length;

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "No se recibieron registros (rows vacíos)", report });
    }

    const tableName = "registros_trimestral";

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

    // Limpieza + recortes (evita 3 errores típicos)
    const cleaned = [];

    for (const raw of rows) {
      if (isTrulyEmptyRow(raw)) {
        report.empty_discarded += 1;
        continue;
      }

      const curpRaw = raw?.curp;
      const curpClean = normalizeCurpForDb(curpRaw);

      if (norm(curpRaw) !== null && curpClean === null) {
        report.curp_invalid_to_null += 1;
      }

      cleaned.push({
        enlace_nombre: clip(raw.enlace_nombre, 120),
        enlace_primer_apellido: clip(raw.enlace_primer_apellido, 120),
        enlace_segundo_apellido: clip(raw.enlace_segundo_apellido, 120),
        enlace_correo: clip(raw.enlace_correo, 200),
        enlace_telefono: clip(raw.enlace_telefono, 50),

        trimestre: clip(raw.trimestre, 60),
        id_rusp: clip(raw.id_rusp, 60),

        primer_apellido: clip(raw.primer_apellido, 120),
        segundo_apellido: clip(raw.segundo_apellido, 120),
        nombre: clip(raw.nombre, 160),

        curp: curpClean, // seguro 18 o NULL

        nivel_puesto: clip(raw.nivel_puesto, 80),
        nivel_tabular: clip(raw.nivel_tabular, 80),
        ramo_ur: clip(raw.ramo_ur, 140),
        dependencia: clip(raw.dependencia, 220),

        correo_institucional: clip(raw.correo_institucional, 200),
        telefono_institucional: clip(raw.telefono_institucional, 50),

        nivel_educativo: clip(raw.nivel_educativo, 120),
        institucion_educativa: clip(raw.institucion_educativa, 220),

        modalidad: clip(raw.modalidad, 120),
        estado_avance: clip(raw.estado_avance, 120),

        // Observaciones puede venir gigantesco: recorte alto para evitar falla
        observaciones: clip(raw.observaciones, 1500),

        usuario_registro: clip(raw.usuario_registro, 80),
      });
    }

    report.processed = cleaned.length;

    if (!cleaned.length) {
      return res.status(200).json({ success: true, message: "Nada que insertar (todas vacías)", report });
    }

    const BATCH = 200;

    for (let i = 0; i < cleaned.length; i += BATCH) {
      const batch = cleaned.slice(i, i + BATCH);

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

        report.inserted += ins;
        report.duplicates_omitted += (batch.length - ins);
      } catch (e) {
        // fallback por fila (para NO perder nada)
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

            report.inserted += ins1;
            report.duplicates_omitted += (1 - ins1);
          } catch (e2) {
            report.errors_count += 1;
            if (report.errors.length < 50) {
              report.errors.push({
                message: e2?.message || String(e2),
                trimestre: r.trimestre ?? null,
                curp: r.curp ?? null,
                id_rusp: r.id_rusp ?? null,
                nombre: r.nombre ?? null,
                primer_apellido: r.primer_apellido ?? null,
                segundo_apellido: r.segundo_apellido ?? null,
              });
            }
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Carga masiva completada",
      report,
      note:
        "Se recortan strings para evitar fallas por longitud. Filas solo se descartan si están totalmente vacías.",
    });
  } catch (err) {
    console.error("bulkCreate fatal:", err);
    return res.status(500).json({
      success: false,
      message: "Error del servidor",
      error: err?.message || String(err),
      report,
    });
  }
}
