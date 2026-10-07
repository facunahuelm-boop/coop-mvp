-- 0062 — Fase 2H "Asistente de alta, importador de núcleos, plantillas de texto y reportes".
--
--  - organizations.modalidad (ayuda mutua / ahorro previo) y alta_completada_en
--    (el asistente «Tu cooperativa está lista»). Las cooperativas que ya existen
--    quedan marcadas como listas, para no mostrarles el asistente.
--  - nucleos_familiares / socio_integrantes: importacion_id, para poder deshacer
--    una importación del padrón entera (baja lógica, nunca se borra).
--  - plantillas_texto: notas, constancias y convocatorias con variables
--    ({socio}, {nucleo}, {fecha}, {monto}…) que salen en PDF.
-- No destructiva.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS modalidad TEXT NOT NULL DEFAULT 'ayuda_mutua';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_modalidad_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_modalidad_check CHECK (modalidad IN ('ayuda_mutua', 'ahorro_previo'));
  END IF;
END $$;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alta_completada_en TEXT;
UPDATE organizations SET alta_completada_en = now()::text WHERE alta_completada_en IS NULL;

ALTER TABLE nucleos_familiares ADD COLUMN IF NOT EXISTS importacion_id INTEGER REFERENCES importaciones(id);
ALTER TABLE socio_integrantes ADD COLUMN IF NOT EXISTS importacion_id INTEGER REFERENCES importaciones(id);

CREATE TABLE IF NOT EXISTS plantillas_texto (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'otro' CHECK (categoria IN ('constancia', 'nota', 'convocatoria', 'acta', 'otro')),
  cuerpo TEXT NOT NULL,
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  actualizado_en TEXT
);

DO $$
BEGIN
  ALTER TABLE plantillas_texto ENABLE ROW LEVEL SECURITY;
  ALTER TABLE plantillas_texto FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON plantillas_texto;
  CREATE POLICY tenant_isolation ON plantillas_texto
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON plantillas_texto TO app_user;
    REVOKE DELETE ON plantillas_texto FROM app_user;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
