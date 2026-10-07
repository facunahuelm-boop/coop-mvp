-- 0057 — Fase 2C "Socios: ciclo de vida".
--
--  - socio_estados: historial de cada cambio de estado del socio (aspirante →
--    activo → suspendido → renunciante → excluido → egresado), con la fecha
--    en que rige, el motivo y quién lo registró. Se carga el estado actual de
--    cada socio como primer renglón (con su fecha de ingreso).
--  - checklist_ingreso: los pasos para recibir a un socio nuevo (documentos,
--    núcleo, usuario, bienvenida, inducción, cuota).
--  - habilidades_nucleo pasa a ser el directorio de oficios: quién del núcleo
--    sabe qué, sin borrar (activo = 0 para quitar).
--  - Núcleo como entidad central (plan, 8.1): cada socio titular que todavía
--    no tiene núcleo recibe uno con su nombre (para horas, cuotas y código de
--    pago). No cambia ni borra nada de lo existente: sólo completa lo vacío.
--    Los códigos de pago viejos ("XXX-S12") se siguen reconociendo.
-- No destructiva.

CREATE TABLE IF NOT EXISTS socio_estados (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  estado_anterior TEXT,
  estado_nuevo TEXT NOT NULL,
  fecha TEXT NOT NULL,
  motivo TEXT,
  registrado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_socio_estados_socio ON socio_estados (socio_id, fecha);

CREATE TABLE IF NOT EXISTS checklist_ingreso (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  item TEXT NOT NULL,
  hecho SMALLINT NOT NULL DEFAULT 0,
  hecho_en TEXT,
  hecho_por_id INTEGER REFERENCES users(id),
  nota TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checklist_ingreso ON checklist_ingreso (socio_id, item);

ALTER TABLE socios ADD COLUMN IF NOT EXISTS ingreso_completo_en TEXT;

ALTER TABLE habilidades_nucleo ADD COLUMN IF NOT EXISTS persona TEXT;
ALTER TABLE habilidades_nucleo ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE habilidades_nucleo ADD COLUMN IF NOT EXISTS activo SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE habilidades_nucleo ADD COLUMN IF NOT EXISTS creado_por_id INTEGER REFERENCES users(id);
ALTER TABLE habilidades_nucleo ADD COLUMN IF NOT EXISTS creado_en TEXT DEFAULT (now()::text);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['socio_estados', 'checklist_ingreso'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)
         WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)',
      t
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
      EXECUTE format('REVOKE DELETE ON %I FROM app_user', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
    REVOKE DELETE ON habilidades_nucleo FROM app_user;
    REVOKE DELETE ON lista_espera FROM app_user;
  END IF;
END $$;

-- Por cooperativa (con o sin Row-Level Security forzada para quien migra).
DO $$
DECLARE
  o RECORD;
  soc RECORD;
  n_id INTEGER;
BEGIN
  FOR o IN SELECT id FROM organizations ORDER BY id LOOP
    PERFORM set_config('app.current_org_id', o.id::text, true);
    -- Historial: el estado actual de cada socio como primer renglón.
    INSERT INTO socio_estados (organization_id, socio_id, estado_anterior, estado_nuevo, fecha, motivo)
    SELECT s.organization_id, s.id, NULL, COALESCE(s.estado, 'activo'),
           COALESCE(NULLIF(left(s.fecha_ingreso, 10), ''), left(s.creado_en, 10), to_char(now(), 'YYYY-MM-DD')),
           'Estado al empezar a registrar el historial'
      FROM socios s
     WHERE s.organization_id = o.id
       AND NOT EXISTS (SELECT 1 FROM socio_estados e WHERE e.socio_id = s.id);
    -- Núcleo para cada socio titular sin núcleo (los dados de baja quedan como están).
    FOR soc IN SELECT id, nombre, user_id FROM socios
              WHERE organization_id = o.id AND nucleo_id IS NULL AND COALESCE(estado, 'activo') NOT IN ('baja', 'egresado', 'excluido')
              ORDER BY id LOOP
      INSERT INTO nucleos_familiares (organization_id, nombre) VALUES (o.id, 'Núcleo ' || soc.nombre) RETURNING id INTO n_id;
      UPDATE socios SET nucleo_id = n_id WHERE id = soc.id;
      IF soc.user_id IS NOT NULL THEN
        UPDATE users SET nucleo_id = n_id WHERE id = soc.user_id AND nucleo_id IS NULL;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.current_org_id', '', true);
END $$;
