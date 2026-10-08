-- 0071 — Fase 3I "Semáforo de salud, encuestas rápidas y automatizaciones A25/A28".
--
--  - encuestas / encuesta_respuestas: una pregunta corta con opciones, una
--    respuesta por persona. Se cierran o anulan, no se borran.
--  - medidas_propuestas: lo que COOVA propone según el reglamento (A25: un
--    núcleo con deuda de horas por encima del límite) y que alguien de la
--    conducción tiene que aprobar o descartar. Nunca se aplica solo.
--  - reclamos.escalado_en: cuándo se escaló un reclamo sin respuesta (A28).
-- No destructiva.

CREATE TABLE IF NOT EXISTS encuestas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  pregunta TEXT NOT NULL,
  opciones JSONB NOT NULL,
  multiple SMALLINT NOT NULL DEFAULT 0,
  anonima SMALLINT NOT NULL DEFAULT 1,
  cierra_en TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada', 'anulada')),
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  cerrada_en TEXT
);

CREATE TABLE IF NOT EXISTS encuesta_respuestas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  encuesta_id INTEGER NOT NULL REFERENCES encuestas(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  opciones JSONB NOT NULL,
  comentario TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (encuesta_id, user_id)
);

CREATE TABLE IF NOT EXISTS medidas_propuestas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tipo TEXT NOT NULL,
  nucleo_id INTEGER REFERENCES nucleos_familiares(id),
  titulo TEXT NOT NULL,
  detalle TEXT,
  medida TEXT NOT NULL,
  periodo TEXT,
  estado TEXT NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta', 'aprobada', 'descartada')),
  decidido_por_id INTEGER REFERENCES users(id),
  decidido_en TEXT,
  motivo TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_medidas_propuestas_estado ON medidas_propuestas (organization_id, estado);

ALTER TABLE reclamos ADD COLUMN IF NOT EXISTS escalado_en TEXT;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['encuestas', 'encuesta_respuestas', 'medidas_propuestas'] LOOP
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
