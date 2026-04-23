-- SABG Fase 5 - ajustes de estabilidad y rendimiento para produccion.
-- Ejecutar cada sentencia por separado o con un cliente que NO envuelva todo
-- en una transaccion, porque CREATE INDEX CONCURRENTLY no lo permite.

-- Login y validacion de usuarios.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_usuarios_usuario
ON public.usuarios (usuario);

-- Listados ordenados por fecha para trimestre.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_registros_created_id
ON public.registros_trimestral (created_at DESC, id DESC);

-- Filtro frecuente por dependencia normalizada y orden.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_registros_dep_created_id
ON public.registros_trimestral (UPPER(BTRIM(dependencia)), created_at DESC, id DESC);

-- Consultas por anio/trimestre.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_registros_anio_trim_created
ON public.registros_trimestral (anio, trimestre, created_at DESC);

-- Listados de evidencias por fecha.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_evidencias_created_id
ON public.evidencias_mensuales (created_at DESC, id DESC);

-- Filtros mas comunes en evidencias: dependencia, anio y mes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_evidencias_dep_anio_mes_created
ON public.evidencias_mensuales (UPPER(BTRIM(dependencia)), anio, mes, created_at DESC);

-- Si despues se consulta la bitacora, esta ayuda a leer lo mas reciente.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sabg_audit_logs_created
ON public.audit_logs (created_at DESC);

-- Refresca estadisticas del optimizador una vez creados los indices.
ANALYZE public.usuarios;
ANALYZE public.registros_trimestral;
ANALYZE public.evidencias_mensuales;
ANALYZE public.audit_logs;
