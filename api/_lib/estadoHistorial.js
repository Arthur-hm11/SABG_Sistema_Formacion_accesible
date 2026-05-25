export const ESTADOS_AVANCE_VALIDOS = new Set([
  "CAMBIÓ LA INSTITUCIÓN ACADÉMICA DE INTERÉS",
  "PERSONA INTERESADA",
  "PERSONA INSCRITA",
  "PERSONA CURSANDO NIVEL EDUCATIVO",
  "PERSONA QUE CONCLUYÓ SUS ESTUDIOS",
  "PERSONA EN PROCESO DE TITULACIÓN",
  "PERSONA QUE DESERTÓ",
  "PERSONA SUSPENDIDA",
  "OTRA",
]);

export async function ensureEstadoHistorialTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.registros_trimestral_estado_historial (
      id BIGSERIAL PRIMARY KEY,
      registro_id BIGINT NOT NULL REFERENCES public.registros_trimestral(id) ON DELETE CASCADE,
      estado_anterior TEXT,
      estado_nuevo TEXT NOT NULL,
      motivo TEXT NOT NULL,
      usuario TEXT,
      rol TEXT,
      dependencia TEXT,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_registros_trimestral_estado_historial_registro_fecha
    ON public.registros_trimestral_estado_historial (registro_id, changed_at DESC, id DESC)
  `);
}

export async function insertEstadoHistorial(db, payload) {
  await ensureEstadoHistorialTable(db);

  await db.query(
    `
      INSERT INTO public.registros_trimestral_estado_historial (
        registro_id,
        estado_anterior,
        estado_nuevo,
        motivo,
        usuario,
        rol,
        dependencia
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      payload.registroId,
      payload.estadoAnterior || null,
      payload.estadoNuevo,
      payload.motivo,
      payload.usuario || null,
      payload.rol || null,
      payload.dependencia || null,
    ]
  );
}

