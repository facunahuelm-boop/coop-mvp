-- 0059 — Fase 2E "Trámites e hitos" (Pre-obra).
--
-- Lista de pasos que la cooperativa tiene que cumplir antes de construir
-- (personería, terreno, proyecto, préstamo, permisos…), cada uno con
-- responsable, fecha estimada, estado y documentos. El socio lo ve como una
-- línea de tiempo simple: «¿En qué estamos?». A27: si un paso pasa su fecha
-- sin terminarse, se avisa al responsable y al Consejo.
-- No destructiva.

CREATE TABLE IF NOT EXISTS tramites_hitos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  categoria TEXT NOT NULL DEFAULT 'otro',
  orden INTEGER NOT NULL DEFAULT 0,
  responsable_id INTEGER REFERENCES users(id),
  responsable_texto TEXT,
  fecha_estimada TEXT,
  fecha_real TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'hecho', 'trabado', 'no_aplica')),
  visible_socios SMALLINT NOT NULL DEFAULT 1,
  nota_para_socios TEXT,
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  actualizado_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_tramites_orden ON tramites_hitos (organization_id, orden);

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tramite_id INTEGER REFERENCES tramites_hitos(id);

DO $$
BEGIN
  ALTER TABLE tramites_hitos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tramites_hitos FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON tramites_hitos;
  CREATE POLICY tenant_isolation ON tramites_hitos
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON tramites_hitos TO app_user;
    REVOKE DELETE ON tramites_hitos FROM app_user;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
