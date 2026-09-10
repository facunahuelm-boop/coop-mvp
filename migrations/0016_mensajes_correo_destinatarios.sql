-- Ampliación de Mails (pedido explícito): "profesional, que se pueda enviar
-- a todo el mundo" y "que tengas registro... a quién se los mandás". Agrega:
--   - destinatario_tipo ahora también acepta 'todos' (mandarle a todos los
--     usuarios activos de la cooperativa de una sola vez), además de
--     'usuario' y 'comision'.
--   - una columna "destinatarios" (JSONB) con el nombre y el email exactos
--     de cada persona que recibió el mail en el momento del envío, para que
--     el historial pueda mostrar la lista real de gente ("a quién se lo
--     mandaste"), no solo un número.
--
-- CREATE TABLE IF NOT EXISTS por si ésta termina siendo la primera vez que
-- se corre algo para Mails (si nunca se llegó a ejecutar
-- 0014_mensajes_correo.sql); si esa migración ya corrió, esto solo agrega
-- la columna nueva y afloja destinatario_id, sin tocar los mails que ya
-- existan.

CREATE TABLE IF NOT EXISTS mensajes_correo (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  remitente_id INTEGER NOT NULL REFERENCES users(id),
  destinatario_tipo TEXT NOT NULL, -- 'usuario' | 'comision' | 'todos'
  destinatario_id INTEGER, -- null cuando destinatario_tipo = 'todos'
  destinatario_nombre TEXT NOT NULL,
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  cantidad_destinatarios INTEGER NOT NULL DEFAULT 1,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mensajes_correo ALTER COLUMN destinatario_id DROP NOT NULL;
ALTER TABLE mensajes_correo ADD COLUMN IF NOT EXISTS destinatarios JSONB NOT NULL DEFAULT '[]'::jsonb;

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

INSERT INTO schema_migrations (filename) VALUES ('0016_mensajes_correo_destinatarios.sql') ON CONFLICT (filename) DO NOTHING;
