# Fase 5 - Estabilidad y rendimiento SABG

Esta fase endurece la capa operativa sin mover la logica del sistema.

## Cambios ya preparados en codigo

- Pool compartido de PostgreSQL con limites, keepalive y timeouts.
- `audit/log` reutiliza el pool principal.
- Timeouts HTTP y cierre limpio del servidor Node.
- `render.yaml` alineado al servicio `standard`.

## Script SQL recomendado

Archivo:

- `scripts/sql/phase5_stability.sql`

Objetivo:

- acelerar login (`usuarios.usuario`)
- acelerar listados trimestrales y de evidencias ordenados por fecha
- acelerar filtros por dependencia normalizada, anio, trimestre y mes
- refrescar estadisticas de PostgreSQL despues de crear indices

## Orden recomendado para aplicar

1. Ejecutar primero `scripts/sql/phase1_indexes.sql` si aun no se aplico.
2. Ejecutar despues `scripts/sql/phase5_stability.sql`.
3. Validar:
   - login
   - listado trimestral
   - listado de evidencias
   - dashboard de seguimiento institucional

## Notas

- Los `CREATE INDEX CONCURRENTLY` estan pensados para no bloquear escrituras normales.
- Si alguna tabla no existiera en un ambiente distinto, conviene comentar solo esa linea puntual, no todo el script.
- `ANALYZE` ayuda a que PostgreSQL use mejor los indices nuevos.
