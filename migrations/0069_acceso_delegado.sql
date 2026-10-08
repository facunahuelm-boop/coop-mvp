-- 0069 — Fase 3G "Acceso delegado para familiares".
--
--  - accesos_delegados: un familiar (con su propia cuenta) puede ayudar a un
--    socio: ver su estado de cuenta, sus horas y avisos y, si el socio lo
--    permite, avisar una ausencia en su nombre. Todo queda en la auditoría.
--    Se revoca, no se borra.
-- No destructiva.

CREATE TABLE IF NOT EXISTS accesos_delegados (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  delegado_user_id INTEGER NOT NULL REFERENCES users(id),
  relacion TEXT,
  puede_actuar SMALLINT NOT NULL DEFAULT 0,
  otorgado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  revocado_en TEXT,
  revocado_por_id INTEGER REFERENCES users(id),
  motivo_revocacion TEXT
);
CREATE INDEX IF NOT EXISTS idx_accesos_delegados_delegado ON accesos_delegados (delegado_user_id);
CREATE INDEX IF NOT EXISTS idx_accesos_delegados_socio ON accesos_delegados (socio_id);

DO $$
BEGIN
  ALTER TABLE accesos_delegados ENABLE ROW LEVEL SECURITY;
  ALTER TABLE accesos_delegados FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON accesos_delegados;
  CREATE POLICY tenant_isolation ON accesos_delegados
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON accesos_delegados TO app_user;
    REVOKE DELETE ON accesos_delegados FROM app_user;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
