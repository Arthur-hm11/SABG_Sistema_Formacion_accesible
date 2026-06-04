import pool from "./db.js";
import { ensureRegistrosTrimestralSchema, normalizeExtendedFields } from "./registrosSchema.js";

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function upperOrNull(v) {
  const s = norm(v);
  return s ? s.toUpperCase() : null;
}

function clip(v, max) {
  const s = norm(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function normalizeHeaderKey(h) {
  return String(h || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const HEADER_ALIASES = {
  periodo_ruta: ["periodo_ruta", "periodo ruta"],
  anio: ["anio", "ano", "año", "a_o", "a o", "year", "ejercicio"],
  trimestre: ["trimestre", "trim", "periodo"],
  id_rusp: ["id_rusp", "rusp", "idrusp"],
  primer_apellido: ["primer_apellido", "apellido_paterno", "ap_paterno", "paterno"],
  segundo_apellido: ["segundo_apellido", "apellido_materno", "ap_materno", "materno"],
  nombre: ["nombre", "nombres", "nombre_s", "nombre_s_"],
  nombre_completo: ["nombre_completo", "nombre completo"],
  sexo: ["sexo"],
  curp: ["curp"],
  nivel_puesto: ["nivel_puesto", "nivel de puesto", "puesto", "nivel puesto"],
  nivel_tabular: ["nivel_tabular", "nivel tabular", "tabular", "nivel tab"],
  ramo_ur: ["ramo_ur", "ramo-ur", "ramo ur", "ur", "ramo"],
  dependencia: ["dependencia", "institucion", "dependencia_entidad", "dependencia/entidad", "entidad"],
  correo_institucional: ["correo_institucional", "correo", "email", "e_mail"],
  telefono_institucional: ["telefono_institucional_con_extension", "telefono_institucional", "telefono", "tel", "telefono_oficina"],
  nivel_educativo: ["nivel_educativo", "nivel_de_estudios", "nivel_estudios"],
  institucion_educativa: ["institucion_educativa", "institucion educativa", "institucion", "escuela"],
  modalidad: ["modalidad"],
  estado_avance: ["estado_avance", "estado_de_avance", "estado de avance", "avance", "estatus"],
  persona_reportada_por: ["persona_reportada_por", "persona reportada por"],
  reporte_institucion_educativa: [
    "reporte_de_institucion_educativa_respuesta_oficio_28_11_2025",
    "reporte_de_institucion_educativa",
    "reporte de institucion educativa",
    "respuesta oficio 28/11/2025"
  ],
  ruta_2026: [
    "registro_unico_de_trayectoria_academica_ruta_2026",
    "registro_unico_de_trayectoria_academica",
    "ruta_2026",
    "ruta 2026"
  ],
  observaciones: ["observaciones", "obs", "comentarios"],
  enlace_nombre: ["enlace_nombre", "enlace nombre", "nombre_enlace", "enlace"],
  enlace_primer_apellido: ["enlace_primer_apellido", "enlace primer apellido", "primer_apellido_enlace", "apellido_paterno_enlace"],
  enlace_segundo_apellido: ["enlace_segundo_apellido", "enlace segundo apellido", "segundo_apellido_enlace", "apellido_materno_enlace"],
  enlace_correo: ["enlace_correo", "correo_enlace", "email_enlace", "correo del enlace"],
  enlace_telefono: ["enlace_telefono", "telefono_enlace", "tel_enlace", "telefono del enlace"],
};

function classifyCurp(curpVal) {
  const s = upperOrNull(curpVal);
  if (!s) return { status: "missing", value: null };

  const allowedMissing = new Set([
    "SIN CURP",
    "S/CURP",
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
  if (compact.length !== 18) return { status: "invalid", value: clip(s, 100) };
  if (!/^[A-Z0-9]{18}$/.test(compact)) return { status: "invalid", value: clip(s, 100) };
  return { status: "valid", value: compact };
}

function isTrulyEmptyRow(r) {
  const keys = [
    "periodo_ruta",
    "anio",
    "trimestre",
    "id_rusp",
    "primer_apellido",
    "segundo_apellido",
    "nombre",
    "nombre_completo",
    "sexo",
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
    "persona_reportada_por",
    "reporte_institucion_educativa",
    "ruta_2026",
    "observaciones",
    "enlace_nombre",
    "enlace_primer_apellido",
    "enlace_segundo_apellido",
    "enlace_correo",
    "enlace_telefono",
    "usuario_registro",
  ];

  return !keys.some((k) => {
    const v = r?.[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

export function mapMatrixRowsToPayloads(rowsMatrix = []) {
  const rows = Array.isArray(rowsMatrix) ? rowsMatrix : [];
  const normRows = rows.map((r) => (r || []).map((c) => normalizeHeaderKey(c)));
  const expectedCandidates = Object.values(HEADER_ALIASES).flat().map(normalizeHeaderKey);

  let headerIdx = 0;
  let bestScore = -1;
  const scanMax = Math.min(normRows.length, 25);
  for (let i = 0; i < scanMax; i++) {
    const row = normRows[i] || [];
    let score = 0;
    for (const candidate of expectedCandidates) {
      if (row.includes(candidate)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  if (bestScore < 3) {
    throw new Error("No se detectaron encabezados válidos en el archivo XLSX.");
  }

  const headerRow = normRows[headerIdx];
  const bodyRows = rows.slice(headerIdx + 1);

  const idxMap = {};
  for (const key of Object.keys(HEADER_ALIASES)) {
    idxMap[key] = -1;
    for (const alias of HEADER_ALIASES[key]) {
      const idx = headerRow.indexOf(normalizeHeaderKey(alias));
      if (idx !== -1) {
        idxMap[key] = idx;
        break;
      }
    }
  }

  const payloads = [];
  for (const row of bodyRows) {
    const payload = {};
    for (const key of Object.keys(idxMap)) {
      const idx = idxMap[key];
      payload[key] = idx >= 0 ? String(row[idx] ?? "").trim() : "";
    }
    payloads.push(payload);
  }

  return payloads;
}

export async function bulkInsertRows(rawRows = [], db = pool) {
  await ensureRegistrosTrimestralSchema(db);

  const report = {
    received: Array.isArray(rawRows) ? rawRows.length : 0,
    empty_discarded: 0,
    processed: 0,
    curp_missing_allowed: 0,
    curp_invalid_preserved: 0,
    inserted: 0,
    errors_count: 0,
    errors: [],
  };

  const cols = [
    "enlace_nombre",
    "enlace_primer_apellido",
    "enlace_segundo_apellido",
    "enlace_correo",
    "enlace_telefono",
    "periodo_ruta",
    "anio",
    "trimestre",
    "id_rusp",
    "primer_apellido",
    "segundo_apellido",
    "nombre",
    "nombre_completo",
    "sexo",
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
    "persona_reportada_por",
    "reporte_institucion_educativa",
    "ruta_2026",
    "observaciones",
    "usuario_registro",
  ];

  const cleaned = [];

  for (const raw of Array.isArray(rawRows) ? rawRows : []) {
    if (isTrulyEmptyRow(raw)) {
      report.empty_discarded += 1;
      continue;
    }

    const curpInfo = classifyCurp(raw?.curp);
    if (curpInfo.status === "missing") {
      report.curp_missing_allowed += 1;
    } else if (curpInfo.status === "invalid") {
      report.curp_invalid_preserved += 1;
    }

    const anioSeguro =
      raw?.anio ?? raw?.ano ?? raw?.año ?? raw?.AÑO ?? raw?.ANIO ?? raw?.Ano ?? null;

    const extended = normalizeExtendedFields({
      anio: anioSeguro,
      trimestre: raw?.trimestre,
      primer_apellido: raw?.primer_apellido,
      segundo_apellido: raw?.segundo_apellido,
      nombre: raw?.nombre,
      nombre_completo: raw?.nombre_completo,
      sexo: raw?.sexo,
      persona_reportada_por: raw?.persona_reportada_por,
      reporte_institucion_educativa: raw?.reporte_institucion_educativa,
      ruta_2026: raw?.ruta_2026,
      nivel_educativo: raw?.nivel_educativo,
      periodo_ruta: raw?.periodo_ruta,
    });

    cleaned.push({
      enlace_nombre: clip(raw.enlace_nombre, 200),
      enlace_primer_apellido: clip(raw.enlace_primer_apellido, 100),
      enlace_segundo_apellido: clip(raw.enlace_segundo_apellido, 100),
      enlace_correo: clip(raw.enlace_correo, 200),
      enlace_telefono: clip(raw.enlace_telefono, 50),

      periodo_ruta: clip(extended.periodo_ruta, 20),
      anio: clip(String(anioSeguro ?? raw.anio ?? ""), 4),
      trimestre: clip(raw.trimestre, 50),
      id_rusp: clip(raw.id_rusp, 100),
      primer_apellido: clip(raw.primer_apellido, 100),
      segundo_apellido: clip(raw.segundo_apellido, 100),
      nombre: clip(raw.nombre, 200),
      nombre_completo: clip(extended.nombre_completo, 300),
      sexo: clip(extended.sexo, 30),

      curp: curpInfo.value,

      nivel_puesto: clip(raw.nivel_puesto, 200),
      nivel_tabular: clip(raw.nivel_tabular, 50),
      ramo_ur: clip(raw.ramo_ur, 50),
      dependencia: norm(raw.dependencia),
      correo_institucional: clip(raw.correo_institucional, 200),
      telefono_institucional: clip(raw.telefono_institucional, 50),
      nivel_educativo: clip(raw.nivel_educativo, 100),
      institucion_educativa: norm(raw.institucion_educativa),
      modalidad: norm(raw.modalidad),
      estado_avance: norm(raw.estado_avance),
      persona_reportada_por: clip(extended.persona_reportada_por, 120),
      reporte_institucion_educativa: clip(extended.reporte_institucion_educativa, 200),
      ruta_2026: clip(extended.ruta_2026, 250),
      observaciones: norm(raw.observaciones),

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
      INSERT INTO registros_trimestral (${cols.join(",")})
      VALUES ${placeholders.join(",")}
    `;

    try {
      const result = await db.query(sql, values);
      const inserted = result.rowCount || 0;
      report.inserted += inserted;
    } catch (e) {
      for (const r of batch) {
        try {
          const singleSql = `
            INSERT INTO registros_trimestral (${cols.join(",")})
            VALUES (${cols.map((_, idx) => `$${idx + 1}`).join(",")})
          `;
          const singleVals = cols.map((c) => r[c] ?? null);
          const singleRes = await db.query(singleSql, singleVals);
          const inserted = singleRes.rowCount || 0;
          report.inserted += inserted;
        } catch (singleError) {
          report.errors_count += 1;
          if (report.errors.length < 50) {
            report.errors.push({
              message: "No se pudo insertar la fila",
              trimestre: r.trimestre ?? null,
              id_rusp: r.id_rusp ?? null,
              curp: r.curp ?? null,
              detalle: singleError?.message || null,
            });
          }
        }
      }
    }
  }

  return report;
}
