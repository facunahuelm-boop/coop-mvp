-- Fase 06 del Plan Maestro — Generalizar "tareas" a cualquier comisión.
--
-- Hoy existen dos conceptos de tarea totalmente separados y no reutilizables:
-- tareas_obra (cronograma de la obra, con etapa/semáforo/dependencias) y
-- tareas_jornada (un cupo de una jornada de ayuda mutua, sin estado ni
-- responsable). Ninguna comisión que no sea Obra o Trabajo tiene forma de
-- llevar sus propios pendientes — la Comisión de Compras, Seguridad, o
-- cualquier comisión que una cooperativa cree (ver 0004_comisiones_reuniones)
-- no tiene dónde anotar "hay que hacer tal cosa" y hacerle seguimiento.
--
-- Esta migración agrega una tabla "tareas" genérica, ligada a comision_id en
-- vez de a obra específicamente. No reemplaza tareas_obra/tareas_jornada
-- (que tienen forma propia y ya están en uso en producción) — las
-- complementa para todo lo que no es obra ni jornada. De paso, deja la base
-- lista para la Fase 09 (generar automáticamente las tareas resultantes de
-- un acta de reunión), que va a insertar filas acá mismo.

CREATE TABLE IF NOT EXISTS tareas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  comision_id INTEGER NOT NULL REFERENCES comisiones(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  responsable_id INTEGER REFERENCES users(id),
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | completada
  prioridad TEXT NOT NULL DEFAULT 'media', -- baja | media | alta
  fecha_vencimiento TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_tareas_org ON tareas (organization_id);
CREATE INDEX IF NOT EXISTS idx_tareas_comision ON tareas (comision_id);
CREATE INDEX IF NOT EXISTS idx_tareas_estado ON tareas (estado);

-- Row-Level Security, mismo criterio que las migraciones anteriores.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['tareas'];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tabla);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int) WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)',
      tabla
    );
  END LOOP;
END $$;

-- Ver nota en migrations/0004_comisiones_reuniones.sql: los permisos de
-- app_user se otorgan tabla por tabla, hace falta repetirlo para tablas nuevas.
GRANT SELECT, INSERT, UPDATE, DELETE ON tareas TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0008_tareas_comision.sql') ON CONFLICT (filename) DO NOTHING;
