import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- Utilidades --------------------
function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function normalizeNullables(v) {
  const s0 = norm(v);
  if (!s0) return null;
  const s = s0.toUpperCase();

  const bad = new Set([
    "SIN INFORMACION",
    "SIN INFORMACIÓN",
    "N/A",
    "NA",
    "NO APLICA",
    "NULL",
    "-",
    "0",
  ]);

  if (bad.has(s)) return null;
  return s0; // conserva caso original si no quieres forzar mayúsculas en todo
}

function normalizeTextKey(v) {
  // Para llaves por nombre/apellidos/trimestre: MAYÚSCULAS + colapsa espacios
  const s0 = norm(v);
  if (!s0) return null;
  return s0.trim().replace(/\s+/g, " ").toUpperCase();
}

function clip(v, max) {
  const s = norm(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeCurpForDb(curpVal) {
  const s0 = normalizeNullables(curpVal);
  if (!s0) return null;

  const s = s0.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 18) return null;
  if (!/^[A-Z0-9]{18}$/.test(s)) return null;

  return s;
}

function normalizeRuspForDb(ruspVal) {
  const s0 = normalizeNullables(ruspVal);
  if (!s0) return null;

  // No forzamos formato exacto, solo limpiamos espacios y dejamos alfanumérico + guiones
  const s = s0.trim();
  return s === "" ? null : s;
}

function isTrulyEmptyRow(r) {
  // Solo descarta si TODO viene vacío
  const keys = [
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

  return !keys.some((k) => {
    const v = r?.[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

// -------------------- Endpoint --------------------
export default async function handler(req, res) {
  // CORS
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
    rusp_invalid_to_null: 0,
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
      return res.status(400).json({
        success: false,
        message: "No se recibieron registros (rows vacío).",
        report,
      });
    }

    const tableName = "registros_trimestral";

    // Columnas EXACTAS que insertamos
    // (OJO: ajusta aquí si tu tabla tiene nombres diferentes)
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

    // 🔒 Límites seguros para NO caer en "value too long"
    // (Si un campo en tu DB es TEXT, puedes dejarlo sin clip usando norm())
    const cleaned = [];

    for (const raw of rows) {
      if (isTrulyEmptyRow(raw)) {
        report.empty_discarded += 1;
        continue;
      }

      // Normalizaciones CLAVE
      const curpRaw = raw?.curp;
      const curpClean = normalizeCurpForDb(curpRaw);
      if (norm(curpRaw) !== null && curpClean === null) report.curp_invalid_to_null += 1;

      const ruspRaw = raw?.id_rusp;
      const ruspClean = normalizeRuspForDb(ruspRaw);
      if (norm(ruspRaw) !== null && ruspClean === null) report.rusp_invalid_to_null += 1;

      // Nombre/apellidos/trimestre como “keys” normalizadas para tu índice parcial por nombres
      const primerApellidoKey = normalizeTextKey(raw?.primer_apellido);
      const segundoApellidoKey = normalizeTextKey(raw?.segundo_apellido);
      const nombreKey = normalizeTextKey(raw?.nombre);
      const trimestreKey = normalizeTextKey(raw?.trimestre);

      cleaned.push({
        // Enlace
        enlace_nombre: clip(raw.enlace_nombre, 200),
        enlace_primer_apellido: clip(raw.enlace_primer_apellido, 100),
        enlace_segundo_apellido: clip(raw.enlace_segundo_apellido, 100),
        enlace_correo: clip(raw.enlace_correo, 200),
        enlace_telefono: clip(raw.enlace_telefono, 50),

        // Identificación / persona
        trimestre: clip(trimestreKey ?? raw.trimestre, 50),
        id_rusp: clip(ruspClean, 100),

        primer_apellido: clip(primerApellidoKey ?? raw.primer_apellido, 100),
        segundo_apellido: clip(segundoApellidoKey ?? raw.segundo_apellido, 100),
        nombre: clip(nombreKey ?? raw.nombre, 200),

        curp: curpClean, // 18 o NULL

        // Datos extra
        nivel_puesto: clip(raw.nivel_puesto, 200),
        nivel_tabular: clip(raw.nivel_tabular, 50),
        ramo_ur: clip(raw.ramo_ur, 50),

        // Dependencia / textos largos
        dependencia: norm(raw.dependencia), // si tu columna es TEXT, no limites
        correo_institucional: clip(raw.correo_institucional, 200),
        telefono_institucional: clip(raw.telefono_institucional, 50),
        nivel_educativo: clip(raw.nivel_educativo, 100),

        institucion_educativa: norm(raw.institucion_educativa), // TEXT
        modalidad: norm(raw.modalidad), // TEXT
        estado_avance: norm(raw.estado_avance), // TEXT
        observaciones: norm(raw.observaciones), // TEXT

        usuario_registro: clip(raw.usuario_registro, 100),
      });
    }

    report.processed = cleaned.length;

    if (!cleaned.length) {
      return res.status(200).json({
        success: true,
        message: "No hay filas para insertar (todas vacías).",
        report,
      });
    }

    const BATCH = 200;

    for (let i = 0; i < cleaned.length; i += BATCH) {
      const batch = cleaned.slice(i, i + BATCH);

      const values = [];
      const placeholders = batch.map((r, rowIdx) => {
        const base = rowIdx * cols.length;
        for (const c of cols) values.push(r[c] ?? null);
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
        // Fallback por fila para NO perder el lote completo
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
        "Normaliza CURP/ID_RUSP (SIN INFORMACION => NULL) y nombres/trimestre (MAYÚSCULAS + trim). ON CONFLICT DO NOTHING evita que truene con índices únicos parciales.",
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
