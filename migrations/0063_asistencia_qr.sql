-- 0063 — Fase 3A "Asistencia por QR en la obra".
--
--  - fichadas_obra: cada vez que un socio escanea el QR del día en la obra y
--    marca "Llegué" o "Me voy". Con la salida, COOVA completa la asistencia
--    del turno (origen 'qr'); si vino sin turno, queda para que el coordinador
--    la confirme. El QR cambia solo cada día (no se guarda: se calcula).
-- No destructiva.

CREATE TABLE IF NOT EXISTS fichadas_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('llegada', 'salida')),
  hora TEXT NOT NULL,
  asignacion_id INTEGER REFERENCES asignaciones_horas(id),
  asistencia_id INTEGER REFERENCES asistencias_horas(id),
  revisada_en TEXT,
  revisada_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_fichadas_obra_fecha ON fichadas_obra (organization_id, fecha);
CREATE INDEX IF NOT EXISTS idx_fichadas_obra_nucleo ON fichadas_obra (nucleo_id, fecha);

DO $$
BEGIN
  ALTER TABLE fichadas_obra ENABLE ROW LEVEL SECURITY;
  ALTER TABLE fichadas_obra FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON fichadas_obra;
  CREATE POLICY tenant_isolation ON fichadas_obra
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON fichadas_obra TO app_user;
    REVOKE DELETE ON fichadas_obra FROM app_user;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
