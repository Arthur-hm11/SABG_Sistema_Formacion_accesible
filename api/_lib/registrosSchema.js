function norm(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function cleanUpper(value) {
  const text = norm(value);
  return text ? text.toUpperCase() : null;
}

function clip(value, max) {
  const text = norm(value);
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeCatalogValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const TRIMESTRE_TO_PERIODO = {
  ENERO_MARZO: "1",
  ABRIL_JUNIO: "2",
  JULIO_SEPTIEMBRE: "3",
  OCTUBRE_DICIEMBRE: "4",
};

const NIVEL_RUTA_PREFIX = {
  PRIMARIA: "█░░░░░ 1. PRIMARIA",
  SECUNDARIA: "██░░░░ 2. SECUNDARIA",
  BACHILLERATO: "███░░░ 3. BACHILLERATO",
  LICENCIATURA: "████░░ 4. LICENCIATURA",
  MAESTRIA: "█████░ 5. MAESTRIA",
  DOCTORADO: "██████ 6. DOCTORADO",
};

export const SEXO_OPCIONES = ["MUJER", "HOMBRE", "SIN INFORMACIÓN"];

export const PERSONA_REPORTADA_POR_OPCIONES = [
  "DEPENDENCIA",
  "DEPENDENCIA E INSTITUCIÓN ACADÉMICA",
  "INSTITUCIÓN ACADÉMICA",
];

export const REPORTE_INSTITUCION_EDUCATIVA_OPCIONES = [
  "1. PERSONA EN PROCESO DE INSCRIPCIÓN",
  "2. PERSONA QUE CURSA NIVEL EDUCATIVO",
  "3. PERSONA CON CRÉDITOS DEL 100%",
  "4. PERSONA QUE OBTUVO CERTIFICADO DEL NIVEL ACADÉMICO",
  "5. PERSONA QUE PRESENTA BAJA TEMPORAL",
  "6. PERSONA QUE PRESENTA BAJA DEFINITIVA",
];

export function computePeriodoRuta(anio, trimestre, explicitValue = null) {
  const explicit = clip(explicitValue, 20);
  if (explicit) return explicit;

  const year = clip(anio, 4);
  const quarter = TRIMESTRE_TO_PERIODO[normalizeCatalogValue(trimestre)] || null;
  if (!year || !quarter) return null;
  return `${quarter}_${year}`;
}

export function computeNombreCompleto(primerApellido, segundoApellido, nombre, explicitValue = null) {
  const explicit = norm(explicitValue);
  if (explicit) return explicit;
  const parts = [primerApellido, segundoApellido, nombre]
    .map((part) => norm(part))
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.join(" ");
}

export function computeRuta2026(nivelEducativo, reporteInstitucionEducativa, explicitValue = null) {
  const explicit = norm(explicitValue);
  if (explicit) return explicit;

  const nivelKey = normalizeCatalogValue(nivelEducativo);
  const prefix = NIVEL_RUTA_PREFIX[nivelKey];
  const reporte = norm(reporteInstitucionEducativa);
  if (!prefix || !reporte) return null;
  return `${prefix} | ${reporte}`;
}

export function normalizeExtendedFields(input = {}) {
  return {
    periodo_ruta: computePeriodoRuta(input.anio, input.trimestre, input.periodo_ruta),
    nombre_completo: computeNombreCompleto(
      input.primer_apellido,
      input.segundo_apellido,
      input.nombre,
      input.nombre_completo
    ),
    sexo: clip(cleanUpper(input.sexo), 30),
    persona_reportada_por: clip(input.persona_reportada_por, 120),
    reporte_institucion_educativa: clip(input.reporte_institucion_educativa, 200),
    ruta_2026: clip(
      computeRuta2026(
        input.nivel_educativo,
        input.reporte_institucion_educativa,
        input.ruta_2026
      ),
      250
    ),
  };
}

export async function ensureRegistrosTrimestralSchema(db) {
  const executor = db && typeof db.query === "function" ? db : null;
  if (!executor) throw new Error("Conexión inválida para asegurar esquema de registros_trimestral");

  await executor.query(`
    ALTER TABLE public.registros_trimestral
      ADD COLUMN IF NOT EXISTS periodo_ruta VARCHAR(20),
      ADD COLUMN IF NOT EXISTS nombre_completo TEXT,
      ADD COLUMN IF NOT EXISTS sexo VARCHAR(30),
      ADD COLUMN IF NOT EXISTS persona_reportada_por VARCHAR(120),
      ADD COLUMN IF NOT EXISTS reporte_institucion_educativa VARCHAR(200),
      ADD COLUMN IF NOT EXISTS ruta_2026 VARCHAR(250)
  `);

  await executor.query(`
    ALTER TABLE public.registros_trimestral
      ALTER COLUMN curp TYPE TEXT
  `);

  const uniqueCurpConstraints = await executor.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'registros_trimestral'
      AND c.contype = 'u'
  `);

  for (const row of uniqueCurpConstraints.rows || []) {
    const definition = String(row.definition || "");
    if (!/\bcurp\b/i.test(definition)) continue;
    const conname = String(row.conname || "").replace(/"/g, "");
    if (!conname) continue;
    await executor.query(`ALTER TABLE public.registros_trimestral DROP CONSTRAINT IF EXISTS "${conname}"`);
  }

  const uniqueCurpIndexes = await executor.query(`
    SELECT idx.relname AS indexname, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_class tbl
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_index i ON i.indrelid = tbl.oid
    JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE ns.nspname = 'public'
      AND tbl.relname = 'registros_trimestral'
      AND i.indisunique = true
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conindid = i.indexrelid
      )
  `);

  for (const row of uniqueCurpIndexes.rows || []) {
    const definition = String(row.definition || "");
    if (!/\bcurp\b/i.test(definition)) continue;
    const indexname = String(row.indexname || "").replace(/"/g, "");
    if (!indexname) continue;
    await executor.query(`DROP INDEX IF EXISTS public."${indexname}"`);
  }

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_registros_trimestral_anio
    ON public.registros_trimestral (anio)
  `);
}
