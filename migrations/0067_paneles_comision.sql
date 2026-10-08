-- 0067 — Fase 3B "Paneles propios por función de comisión".
--
--  - correspondencia: lo que entra y sale de la cooperativa (Comisión
--    Administrativa), con quién la atiende y si espera respuesta. Se anula,
--    no se borra.
--  - elecciones / listas_electorales: el cronograma de una elección y las
--    listas que se presentan (Comisión Electoral). Se anulan/retiran, no se
--    borran.
-- No destructiva.

CREATE TABLE IF NOT EXISTS correspondencia (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  fecha TEXT NOT NULL,
  contraparte TEXT NOT NULL,
  asunto TEXT NOT NULL,
  referencia TEXT,
  documento_id INTEGER REFERENCES documentos(id),
  responsable_id INTEGER REFERENCES users(id),
  requiere_respuesta SMALLINT NOT NULL DEFAULT 0,
  responder_antes TEXT,
  respondida_en TEXT,
  respuesta_id INTEGER REFERENCES correspondencia(id),
  comision_id INTEGER REFERENCES comisiones(id),
  registrado_por_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_correspondencia_fecha ON correspondencia (organization_id, fecha);

CREATE TABLE IF NOT EXISTS elecciones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  titulo TEXT NOT NULL,
  organos TEXT,
  fecha_cierre_listas TEXT,
  fecha_eleccion TEXT NOT NULL,
  asamblea_id INTEGER REFERENCES reuniones(id),
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'realizada', 'anulada')),
  observaciones TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE IF NOT EXISTS listas_electorales (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  eleccion_id INTEGER NOT NULL REFERENCES elecciones(id),
  nombre TEXT NOT NULL,
  integrantes TEXT NOT NULL,
  presentada_en TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'presentada' CHECK (estado IN ('presentada', 'aceptada', 'observada', 'retirada')),
  observaciones TEXT,
  registrada_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_listas_eleccion ON listas_electorales (eleccion_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['correspondencia', 'elecciones', 'listas_electorales'] LOOP
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
