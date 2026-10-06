-- CI: prepara una base Postgres vacía para que corran todas las migraciones
-- igual que en Supabase. Solo para pruebas automáticas — nunca en producción.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_ci' NOBYPASSRLS;
  END IF;
END $$;
-- En producción app_user tiene SELECT/INSERT/UPDATE/DELETE sobre todas las
-- tablas de cooperativas (ver FASE04_SEGURIDAD_DB.md). Se emula eso con
-- privilegios por defecto, para que el CI parta del caso más permisivo y
-- compruebe que las migraciones (0051 en adelante) quitan el DELETE.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
