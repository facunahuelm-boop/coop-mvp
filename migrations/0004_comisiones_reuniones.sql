-- Fase 3 — Módulo de Comisiones y Reuniones.
--
-- "Socios" ya existe (nucleos_familiares) y "Actas" también, pero suelto,
-- sin agenda ni asistencia. Esta migración agrega lo que faltaba:
--   - comisiones: qué comisiones existen (Obra, Trabajo, Compras, etc. o las
--     que defina cada cooperativa) y quién las integra.
--   - reuniones: agenda (orden del día), fecha/lugar, y su vínculo con el
--     acta que ya existía como tabla.
--   - reunion_asistencias: asistencia por núcleo familiar, igual criterio que
--     ya se usa para las jornadas de trabajo (tabla "asistencias").
--
-- A diferencia de 0001-0003, estas tablas nacen multi-tenant directamente
-- (organization_id NOT NULL desde la creación) — no hace falta backfill
-- porque no tienen datos previos.

CREATE TABLE IF NOT EXISTS comisiones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS comision_miembros (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  comision_id INTEGER NOT NULL REFERENCES comisiones(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rol_en_comision TEXT NOT NULL DEFAULT 'integrante', -- coordinador | integrante
  activo INTEGER NOT NULL DEFAULT 1,
  desde TEXT NOT NULL DEFAULT (NOW()::text),
  hasta TEXT
);

CREATE TABLE IF NOT EXISTS reuniones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tipo TEXT NOT NULL, -- asamblea | consejo_directivo | comision
  comision_id INTEGER REFERENCES comisiones(id), -- null salvo tipo = 'comision'
  titulo TEXT NOT NULL,
  fecha TEXT NOT NULL,
  lugar TEXT,
  orden_del_dia TEXT,
  estado TEXT NOT NULL DEFAULT 'planificada', -- planificada | realizada | cancelada
  acta_id INTEGER REFERENCES actas(id),
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS reunion_asistencias (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  reunion_id INTEGER NOT NULL REFERENCES reuniones(id) ON DELETE CASCADE,
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  presente INTEGER NOT NULL DEFAULT 0,
  justificacion TEXT,
  UNIQUE (reunion_id, nucleo_id)
);

-- Vínculo de vuelta: qué reunión originó tal acta (ya existía la tabla, se le
-- agrega la columna). Nullable — hay actas históricas sin reunión asociada.
ALTER TABLE actas ADD COLUMN IF NOT EXISTS reunion_id INTEGER REFERENCES reuniones(id);

CREATE INDEX IF NOT EXISTS idx_comisiones_org ON comisiones (organization_id);
CREATE INDEX IF NOT EXISTS idx_comision_miembros_org ON comision_miembros (organization_id);
CREATE INDEX IF NOT EXISTS idx_comision_miembros_comision ON comision_miembros (comision_id);
CREATE INDEX IF NOT EXISTS idx_comision_miembros_user ON comision_miembros (user_id);
CREATE INDEX IF NOT EXISTS idx_reuniones_org ON reuniones (organization_id);
CREATE INDEX IF NOT EXISTS idx_reuniones_comision ON reuniones (comision_id);
CREATE INDEX IF NOT EXISTS idx_reuniones_fecha ON reuniones (fecha);
CREATE INDEX IF NOT EXISTS idx_reunion_asistencias_org ON reunion_asistencias (organization_id);
CREATE INDEX IF NOT EXISTS idx_reunion_asistencias_reunion ON reunion_asistencias (reunion_id);

-- Row-Level Security, mismo criterio que migrations/0003_rls_policies.sql.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['comisiones', 'comision_miembros', 'reuniones', 'reunion_asistencias'];
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

-- Los permisos de app_user se otorgan tabla por tabla en migrations/README.md
-- vía GRANT ... ON ALL TABLES IN SCHEMA public — para tablas creadas después
-- de ese GRANT inicial hace falta repetirlo (o confiar en ALTER DEFAULT
-- PRIVILEGES si ya quedó configurado). Ver nota en el README de migraciones.
GRANT SELECT, INSERT, UPDATE, DELETE ON comisiones, comision_miembros, reuniones, reunion_asistencias TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
