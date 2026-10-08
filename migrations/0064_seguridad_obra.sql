-- 0064 — Fase 3E "Seguridad en la obra".
--
--  - inspecciones_seguridad.tipo: 'inspeccion' (la de siempre) o 'diaria'
--    (el checklist que se hace desde el celular al empezar el día).
--    inspecciones_seguridad.dia: la fecha (AAAA-MM-DD) del checklist diario.
--  - tareas.inspeccion_id: la tarea correctiva que salió de un punto no
--    cumplido de un checklist o una inspección (A22).
--  - epp_entregas: elementos de protección entregados a cada persona
--    (con constancia). Se anula, no se borra.
--  - inducciones_seguridad: quién hizo la inducción de seguridad y cuándo.
--    Se anula, no se borra.
-- No destructiva.

ALTER TABLE inspecciones_seguridad ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'inspeccion';
ALTER TABLE inspecciones_seguridad ADD COLUMN IF NOT EXISTS dia TEXT;
CREATE INDEX IF NOT EXISTS idx_inspecciones_seguridad_dia ON inspecciones_seguridad (organization_id, tipo, dia);

ALTER TABLE tareas ADD COLUMN IF NOT EXISTS inspeccion_id INTEGER REFERENCES inspecciones_seguridad(id);
CREATE INDEX IF NOT EXISTS idx_tareas_inspeccion ON tareas (inspeccion_id);

CREATE TABLE IF NOT EXISTS epp_entregas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER REFERENCES socios(id),
  integrante_id INTEGER REFERENCES socio_integrantes(id),
  persona_nombre TEXT NOT NULL,
  elemento TEXT NOT NULL,
  talle TEXT,
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  fecha TEXT NOT NULL,
  observaciones TEXT,
  entregado_por_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_epp_entregas_socio ON epp_entregas (organization_id, socio_id);

CREATE TABLE IF NOT EXISTS inducciones_seguridad (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER REFERENCES socios(id),
  integrante_id INTEGER REFERENCES socio_integrantes(id),
  persona_nombre TEXT NOT NULL,
  fecha TEXT NOT NULL,
  dictada_por TEXT,
  temas TEXT,
  registrada_por_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_inducciones_socio ON inducciones_seguridad (organization_id, socio_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['epp_entregas', 'inducciones_seguridad'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
      EXECUTE format('REVOKE DELETE ON %I FROM app_user', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
