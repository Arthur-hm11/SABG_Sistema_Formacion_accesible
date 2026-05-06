import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function upperOrNull(v) {
  const s = norm(v);
  return s ? s.toUpperCase() : null;
}

// recorta a max (evita “value too long”)
function clip(v, max) {
  const s = norm(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// CURP seguro (varchar 18)
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

function classifyCurp(curpVal) {
  const s = upperOrNull(curpVal);
  if (!s) return { status: "missing", value: null };

  const allowedMissing = new Set([
    "SIN CURP",
    "S/CURP",
    "SIN INFORMACION",
    "SIN INFORMACIÓN",
    "NO CUENTA CON CURP",
    "N/A",
    "NO APLICA",
    "NA",
    "NULL",
    "-",
    "0",
  ]);
  if (allowedMissing.has(s)) return { status: "missing", value: null };

  const compact = s.replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 18) return { status: "invalid", value: null };
  if (!/^[A-Z0-9]{18}$/.test(compact)) return { status: "invalid", value: null };
  return { status: "valid", value: compact };
}

// SOLO descarta si TODA la fila está vacía
function isTrulyEmptyRow(r) {
  const keys = [
    "enlace_nombre",
    "enlace_primer_apellido",
    "enlace_segundo_apellido",
    "enlace_correo",
    "enlace_telefono",
    "anio",
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
  const pre = applyCors(req, res);
  if (pre) return;
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Método no permitido" });

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (!isAdminSession(session)) return res.status(403).json({ success: false, message: "No autorizado" });

  const report = {
    received: 0,
    empty_discarded: 0,
    processed: 0,
    curp_missing_allowed: 0,
    curp_invalid_skipped: 0,
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
    if (rows.length > 5000) {
      return res.status(413).json({ success: false, message: "Máximo 5000 registros por carga. Divide el archivo en bloques.", report });
    }

    // columnas EXACTAS de tu tabla (captura)
    const cols = [
      "enlace_nombre",            // varchar(200)
      "enlace_primer_apellido",   // varchar(100)
      "enlace_segundo_apellido",  // varchar(100)
      "enlace_correo",            // varchar(200)
      "enlace_telefono",          // varchar(50)

      "anio",                     // varchar(4)
      "trimestre",                // varchar(50)
      "id_rusp",                  // varchar(100)
      "primer_apellido",          // varchar(100)
      "segundo_apellido",         // varchar(100)
      "nombre",                   // varchar(200)
      "curp",                     // varchar(18)

      "nivel_puesto",             // varchar(200)
      "nivel_tabular",            // varchar(50)
      "ramo_ur",                  // varchar(50)

      "dependencia",              // text (sin límite)
      "correo_institucional",     // varchar(200)
      "telefono_institucional",   // varchar(50)  (tu tabla lo maneja así normalmente)
      "nivel_educativo",          // varchar(100)

      "institucion_educativa",    // text
      "modalidad",                // text
      "estado_avance",            // text
      "observaciones",            // text

      "usuario_registro",         // varchar(100)
    ];

    const tableName = "registros_trimestral";
    const cleaned = [];

    for (const raw of rows) {
      if (isTrulyEmptyRow(raw)) {
        report.empty_discarded += 1;
        continue;
      }

      const curpRaw = raw?.curp;
      const curpInfo = classifyCurp(curpRaw);
      if (curpInfo.status === "missing") {
        report.curp_missing_allowed += 1;
      } else if (curpInfo.status === "invalid") {
        report.curp_invalid_skipped += 1;
        report.errors_count += 1;
        report.errors.push({
          trimestre: raw?.trimestre ?? null,
          curp: curpRaw ?? null,
          id_rusp: raw?.id_rusp ?? null,
          nombre: raw?.nombre ?? null,
          primer_apellido: raw?.primer_apellido ?? null,
          segundo_apellido: raw?.segundo_apellido ?? null,
          message: "CURP inválida. La fila no se guardó."
        });
        continue;
      }

      const anioSeguro =
        raw?.anio ?? raw?.ano ?? raw?.año ?? raw?.AÑO ?? raw?.ANIO ?? raw?.Ano ?? null;

      cleaned.push({
        enlace_nombre: clip(raw.enlace_nombre, 200),
        enlace_primer_apellido: clip(raw.enlace_primer_apellido, 100),
        enlace_segundo_apellido: clip(raw.enlace_segundo_apellido, 100),
        enlace_correo: clip(raw.enlace_correo, 200),
        enlace_telefono: clip(raw.enlace_telefono, 50),

        anio: clip(String(anioSeguro ?? raw.anio ?? ""), 4),
        trimestre: clip(raw.trimestre, 50),
        id_rusp: clip(raw.id_rusp, 100),
        primer_apellido: clip(raw.primer_apellido, 100),
        segundo_apellido: clip(raw.segundo_apellido, 100),
        nombre: clip(raw.nombre, 200),

        curp: curpInfo.value,

        nivel_puesto: clip(raw.nivel_puesto, 200),
        nivel_tabular: clip(raw.nivel_tabular, 50),
        ramo_ur: clip(raw.ramo_ur, 50),

        dependencia: norm(raw.dependencia), // text
        correo_institucional: clip(raw.correo_institucional, 200),
        telefono_institucional: clip(raw.telefono_institucional, 50),
        nivel_educativo: clip(raw.nivel_educativo, 100),

        institucion_educativa: norm(raw.institucion_educativa), // text
        modalidad: norm(raw.modalidad), // text
        estado_avance: norm(raw.estado_avance), // text
        observaciones: norm(raw.observaciones), // text

        usuario_registro: clip(raw.usuario_registro, 100),
      });
    }

    report.processed = cleaned.length;

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
        // fallback 1x1 (para no perder lote completo)
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
                message: "No se pudo insertar la fila",
                trimestre: r.trimestre ?? null,
                id_rusp: r.id_rusp ?? null,
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
      note: "Se recortan strings según límites reales del esquema para evitar 'value too long'.",
    });
  } catch (err) {
    console.error("bulkCreate fatal:", err);
    return res.status(500).json({
      success: false,
      message: "Error del servidor",
      report,
    });
  }
}
