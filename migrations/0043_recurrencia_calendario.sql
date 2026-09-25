-- Rediseño del Calendario, Etapa 2 (pedido explícito, 25/09): actividades que
-- se repiten (punto 12 del pedido original: "posibilidad de que una
-- actividad se repita — diaria, semanal, mensual"). Decisiones confirmadas
-- con el usuario antes de esta migración:
--   1) Frecuencias: sólo presets simples (diaria/semanal/mensual/anual), sin
--      intervalos personalizados ni días de semana específicos — se prioriza
--      que sea fácil de entender para alguien sin práctica con sistemas.
--   2) Fin de la serie: SIEMPRE una fecha límite obligatoria (no se permite
--      "sin fin") — evita generar actividades para siempre y mantiene el
--      alcance de esta etapa acotado.
--   3) Editar/borrar una actividad que es parte de una serie ofrece las 3
--      opciones de Google Calendar ("solo esta" / "esta y las siguientes" /
--      "todas") — se resuelve en la Server Action (ver
--      src/lib/actions/calendarioNotas.ts), no acá.
--
-- Diseño elegido: cada OCURRENCIA de una actividad recurrente es una fila
-- normal de notas_calendario (igual que hoy, editable/borrable individualmente
-- sin ningún cambio de código para ese caso) — se generan todas de una vez al
-- crear la serie. Se prefiere esto a calcular ocurrencias "virtuales" al
-- vuelo porque no hay ningún precedente en este proyecto de fechas
-- calculadas (todo lo que se lista sale de una fila real en la base) y
-- porque mantiene intacta toda la lógica de permisos/edición/borrado ya
-- construida en la Etapa 1 para una sola actividad. La tabla nueva
-- (series_calendario) sólo guarda los datos de la SERIE en sí — a qué
-- frecuencia y hasta cuándo — para poder ofrecer "editar/borrar todas" sin
-- tener que adivinar qué filas pertenecen juntas.
CREATE TABLE IF NOT EXISTS series_calendario (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  autor_id INTEGER NOT NULL REFERENCES users(id),
  frecuencia TEXT NOT NULL, -- diaria | semanal | mensual | anual
  fecha_fin TEXT NOT NULL, -- YYYY-MM-DD, obligatoria (decisión confirmada arriba)
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE series_calendario ENABLE ROW LEVEL SECURITY;
  ALTER TABLE series_calendario FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON series_calendario;
  CREATE POLICY tenant_isolation ON series_calendario
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON series_calendario TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ON DELETE SET NULL (no CASCADE) a propósito, mismo criterio que
-- responsable_id/comision_id de la migración 0042: si por algún motivo la
-- fila de series_calendario desaparece sin pasar por la Server Action de
-- borrado (que sí borra la serie completa de manera explícita), las
-- actividades individuales no deberían desaparecer solas ni quedar con una
-- referencia rota — simplemente dejan de "pertenecer" a una serie.
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS serie_id INTEGER REFERENCES series_calendario(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notas_calendario_serie ON notas_calendario (serie_id);

INSERT INTO schema_migrations (filename) VALUES ('0043_recurrencia_calendario.sql') ON CONFLICT (filename) DO NOTHING;
