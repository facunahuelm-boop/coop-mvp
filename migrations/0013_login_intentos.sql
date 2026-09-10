-- Endurecimiento de seguridad del login (pedido explícito: "que quede con
-- mucha seguridad el servidor", producto que se va a vender realmente).
--
-- Hasta ahora loginAction (src/lib/actions/auth.ts) no dejaba ningún rastro
-- de los intentos fallidos, así que no había límite: alguien podía probar
-- contraseñas sin parar contra un email real (fuerza bruta / diccionario).
-- Esta tabla guarda cada intento (exitoso o no) para que loginAction pueda
-- frenar temporalmente a quien falla demasiadas veces seguidas, sin tocar
-- nada del resto del sistema.
--
-- Se guarda por cooperativa (organization_id) además de por email, con el
-- mismo aislamiento por RLS que el resto de las tablas: un intento de login
-- en una cooperativa nunca cuenta para el límite de otra.

CREATE TABLE IF NOT EXISTS login_intentos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  exitoso INTEGER NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_intentos_email ON login_intentos (organization_id, email, creado_en);

-- Row-Level Security, mismo criterio que el resto de las tablas nuevas.
DO $$
BEGIN
  ALTER TABLE login_intentos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE login_intentos FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON login_intentos;
  CREATE POLICY tenant_isolation ON login_intentos
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON login_intentos TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0013_login_intentos.sql') ON CONFLICT (filename) DO NOTHING;
