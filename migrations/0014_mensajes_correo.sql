-- Módulo de Mails internos (pedido explícito): permite mandarle un mensaje
-- por email a un usuario puntual o a todos los integrantes activos de una
-- comisión de una sola vez, sin tener que escribirle a cada uno por
-- separado. Usa el mismo servidor SMTP que ya se configura en
-- Configuración → Configuración de Email (src/lib/email.ts) — no agrega una
-- segunda configuración de correo aparte.
--
-- Se guarda un historial (quién lo mandó, a quién, asunto y cuerpo) para
-- poder consultar después "¿le avisamos a la comisión de Obra?", con el
-- mismo criterio que ya usa Auditoría para el resto de las acciones del
-- sistema.

CREATE TABLE IF NOT EXISTS mensajes_correo (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  remitente_id INTEGER NOT NULL REFERENCES users(id),
  destinatario_tipo TEXT NOT NULL, -- 'usuario' | 'comision'
  destinatario_id INTEGER NOT NULL,
  -- Copia del nombre al momento de enviar: el historial sigue siendo legible
  -- aunque el usuario o la comisión cambien de nombre o se den de baja después.
  destinatario_nombre TEXT NOT NULL,
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  cantidad_destinatarios INTEGER NOT NULL DEFAULT 1,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_correo_org ON mensajes_correo (organization_id, creado_en DESC);

-- Row-Level Security, mismo criterio que el resto de las tablas.
DO $$
BEGIN
  ALTER TABLE mensajes_correo ENABLE ROW LEVEL SECURITY;
  ALTER TABLE mensajes_correo FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON mensajes_correo;
  CREATE POLICY tenant_isolation ON mensajes_correo
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON mensajes_correo TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0014_mensajes_correo.sql') ON CONFLICT (filename) DO NOTHING;
