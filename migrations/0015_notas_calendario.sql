-- Notas de calendario personalizadas (pedido explícito): hasta ahora el
-- calendario solo mostraba fechas que ya existían en otro módulo (reuniones,
-- jornadas, hitos de obra, vencimientos) — no había forma de escribir algo
-- directamente en una fecha ("el 10 tenemos asamblea de fin de año", por
-- ejemplo) sin que fuera, en rigor, una reunión o una tarea de otro módulo.
--
-- Cualquier persona logueada puede crear una nota; solo quien la creó (o
-- Admin/Consejo Directivo) puede editarla o borrarla — mismo criterio de
-- "dueño de lo que escribió" que ya se usa en otros lugares del sistema,
-- validado en la Server Action (src/lib/actions/calendarioNotas.ts), no acá.

CREATE TABLE IF NOT EXISTS notas_calendario (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  autor_id INTEGER NOT NULL REFERENCES users(id),
  fecha TEXT NOT NULL, -- YYYY-MM-DD
  hora TEXT, -- HH:mm, opcional
  titulo TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'brand', -- brand | verde | amarillo | rojo | gray (misma paleta que Badge, ver components/ui.tsx)
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notas_calendario_org_fecha ON notas_calendario (organization_id, fecha);

-- Row-Level Security, mismo criterio que el resto de las tablas.
DO $$
BEGIN
  ALTER TABLE notas_calendario ENABLE ROW LEVEL SECURITY;
  ALTER TABLE notas_calendario FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON notas_calendario;
  CREATE POLICY tenant_isolation ON notas_calendario
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON notas_calendario TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0015_notas_calendario.sql') ON CONFLICT (filename) DO NOTHING;
