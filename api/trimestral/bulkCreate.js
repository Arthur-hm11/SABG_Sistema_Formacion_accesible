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

  const bad = new Set(["SIN INFORMACION", "SIN INFORMACIÓN", "N/A", "NO APLICA", "NA", "NULL", "-", "0"]);
  if (bad.has(s)) return null;

  const compact = s.replace(/[^A-Z0-9]/g, "");

  // CURP debe ser 18 alfanuméricos
  if (compact.length !== 18) return null;
  if (!/^[A-Z0-9]{18}$/.test(compact)) return null;

  return compact;
}

// Fila "vacía": todos los campos relevantes null/blank
function isEffectivelyEmptyRow(r) {
  // revisa solo campos que de verdad representan un "registro"
  const keys = [
    "trimestre",
    "id_rusp",
    "primer_apellido",
    "segundo_apellido",
    "nombre",
    "curp",
    "dependencia",
    "correo_institucional",
    "telefono_institucional",
    "nivel_educativo",
    "institucion_educativa",
    "modalidad",
    "estado_avance",
    "observaciones",
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

  // ====== CONTADORES (trazabilidad) ======
  const report = {
    received: 0,                 // filas recibidas del frontend
    empty_discarded: 0,          // filas descartadas por vacías
    processed: 0,                // filas enviadas a inserción
    curp_invalid_to_null: 0,     // cuántas CURP se fueron a NULL por inválidas
    inserted: 0,                 // insertadas reales
    duplicates_omitted: 0,       // omitidas por UNIQUE (estimado por rowCount)
    errors_count: 0,
    errors: [],                  // hasta 50
  };

  try {
    const body = req.body || {};
    const rows = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : [];

    report.received = rows.length;

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "No se recibieron registros (rows vacíos)", report });
    }

    // ✅ TABLA REAL
    const tableName = "registros_trimestral";

    // ✅ COLUMNAS REALES
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

    // 1) Limpieza + contadores de vacías y curp inválida
    const cleaned = [];

    for (const raw of rows) {
      if (isEffectivelyEmptyRow(raw)) {
        report.empty_discarded += 1;
        continue;
      }

      const curpRaw = raw?.curp;
      const curpClean = normalizeCurpForDb(curpRaw);

      // si venía algo pero se volvió null, cuenta como inválida
      if (norm(curpRaw) !== null && curpClean === null) {
        report.curp_invalid_to_null += 1;
      }

      cleaned.push({
        enlace_nombre: norm(raw.enlace_nombre),
        enlace_primer_apellido: norm(raw.enlace_primer_apellido),
        enlace_segundo_apellido: norm(raw.enlace_segundo_apellido),
        enlace_correo: norm(raw.enlace_correo),
        enlace_telefono: norm(raw.enlace_telefono),

        trimestre: norm(raw.trimestre),
        id_rusp: norm(raw.id_rusp),
        primer_apellido: norm(raw.primer_apellido),
        segundo_apellido: norm(raw.segundo_apellido),
        nombre: norm(raw.nombre),

        curp: curpClean,

        nivel_puesto: norm(raw.nivel_puesto),
        nivel_tabular: norm(raw.nivel_tabular),
        ramo_ur: norm(raw.ramo_ur),
        dependencia: norm(raw.dependencia),

        correo_institucional: norm(raw.correo_institucional),
        telefono_institucional: norm(raw.telefono_institucional),
        nivel_educativo: norm(raw.nivel_educativo),
        institucion_educativa: norm(raw.institucion_educativa),

        modalidad: norm(raw.modalidad),
        estado_avance: norm(raw.estado_avance),
        observaciones: norm(raw.observaciones),

        usuario_registro: norm(raw.usuario_registro),
      });
    }

    report.processed = cleaned.length;

    if (!cleaned.length) {
      return res.status(200).json({ success: true, message: "Nada que insertar (todas vacías)", report });
    }

    // 2) Inserción por lotes
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
        // fallback por fila
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
        "duplicates_omitted depende de tener UNIQUE parcial: (curp,trimestre) WHERE curp IS NOT NULL. CURP inválida se guarda como NULL.",
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
