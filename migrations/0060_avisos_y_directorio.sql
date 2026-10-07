-- 0060 — Fase 2F "Avisos unificados, WhatsApp v1, preferencias y directorio".
--
--  - avisos / aviso_destinatarios: difusión oficial (a todos, a una comisión,
--    a los morosos, a un núcleo o a un rol) con constancia de envío y de
--    lectura por persona. Canales: aviso en COOVA, email y WhatsApp asistido
--    (links wa.me con el texto listo; se registra cuándo se abrió).
--  - users: teléfono, preferencias de avisos (email, WhatsApp, resumen
--    semanal) y la clave del calendario personal (link ICS).
--  - contactos_externos: el directorio suma IAT, organismos y profesionales
--    (los proveedores siguen en su tabla).
-- No destructiva.

CREATE TABLE IF NOT EXISTS avisos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  titulo TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  destinatarios_tipo TEXT NOT NULL CHECK (destinatarios_tipo IN ('todos', 'socios', 'comision', 'morosos', 'nucleo', 'rol')),
  destinatario_ref TEXT,
  urgente SMALLINT NOT NULL DEFAULT 0,
  por_email SMALLINT NOT NULL DEFAULT 0,
  enviado_por_id INTEGER REFERENCES users(id),
  enviado_en TEXT NOT NULL DEFAULT (now()::text),
  anulado_en TEXT,
  motivo_anulacion TEXT
);

CREATE TABLE IF NOT EXISTS aviso_destinatarios (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  aviso_id INTEGER NOT NULL REFERENCES avisos(id),
  user_id INTEGER REFERENCES users(id),
  socio_id INTEGER REFERENCES socios(id),
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  en_app SMALLINT NOT NULL DEFAULT 0,
  email_enviado_en TEXT,
  whatsapp_abierto_en TEXT,
  leido_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_aviso_destinatarios ON aviso_destinatarios (aviso_id);
CREATE INDEX IF NOT EXISTS idx_aviso_destinatarios_user ON aviso_destinatarios (user_id);

CREATE TABLE IF NOT EXISTS contactos_externos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'otro' CHECK (tipo IN ('iat', 'organismo', 'profesional', 'otro')),
  persona_contacto TEXT,
  telefono TEXT,
  email TEXT,
  notas TEXT,
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS aviso_email SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS aviso_whatsapp SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS resumen_semanal SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ics_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_ics_token ON users (ics_token) WHERE ics_token IS NOT NULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['avisos', 'aviso_destinatarios', 'contactos_externos'] LOOP
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
  END IF;
END $$;
