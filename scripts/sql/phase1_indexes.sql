-- SABG Fase 1 - indices recomendados para produccion.
-- Ejecutar en PostgreSQL fuera de una transaccion.
-- CREATE INDEX CONCURRENTLY evita bloquear escrituras normales mientras se crea el indice.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_registros_dep_created
ON public.registros_trimestral (UPPER(BTRIM(dependencia)), created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_registros_dep_trim_anio
ON public.registros_trimestral (UPPER(BTRIM(dependencia)), trimestre, anio);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_registros_usuario_created
ON public.registros_trimestral (usuario_registro, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_evidencias_dep_created
ON public.evidencias_mensuales (UPPER(BTRIM(dependencia)), created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_evidencias_dep_mes_anio
ON public.evidencias_mensuales (UPPER(BTRIM(dependencia)), mes, anio);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_evidencias_estado_created
ON public.evidencias_mensuales (estado_revision, created_at DESC);
