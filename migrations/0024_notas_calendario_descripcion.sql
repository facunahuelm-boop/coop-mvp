-- Rediseño del Calendario (15/09, pedido explícito): el modal de crear/editar
-- evento pide un campo "Descripción" además de título/fecha/hora/categoría —
-- notas_calendario no lo tenía. Columna nueva, opcional (NULL para todas las
-- notas ya creadas, que siguen funcionando exactamente igual sin ella) — no
-- se toca ninguna otra columna ni tabla existente.
--
-- IMPORTANTE (lección del incidente del 14-15/09): esta migración se aplica
-- a producción ANTES de desplegar el código que lee/escribe "descripcion",
-- nunca después — ver CHANGELOG.md.

ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS descripcion TEXT;

INSERT INTO schema_migrations (filename) VALUES ('0024_notas_calendario_descripcion.sql') ON CONFLICT (filename) DO NOTHING;
