-- Inicio del testing real con UFAMA: núcleos con su numeración real,
-- usuarios "pendientes de activación" (sin email todavía) y respaldo previo a
-- limpiar datos de prueba.
--
-- Todo es ADITIVO o relaja una restricción — no se borra ni se reescribe
-- ningún dato existente:
--   1. socios.numero_nucleo: el N.º real de núcleo de la cooperativa (4, 7,
--      14…). Único por cooperativa entre las fichas no dadas de baja. Se
--      guarda en la ficha de socio (que ya es la unidad familiar del
--      padrón) y no reemplaza a nucleos_familiares, que sigue vinculado
--      para Trabajo/horas.
--   2. users.email deja de ser obligatorio y users.estado_cuenta distingue
--      'activa' de 'pendiente' (persona cargada, todavía sin email para
--      invitarla). Una cuenta pendiente NO puede iniciar sesión: el login
--      busca por email y su email es NULL. La restricción UNIQUE
--      (organization_id, email) sigue valiendo — Postgres permite varios
--      NULL.
--   3. respaldos_limpieza: copia completa (JSON) de lo que una limpieza de
--      datos de prueba está por dar de baja o borrar, guardada ANTES de
--      tocar nada, para poder recuperarlo.
--   4. nucleos_familiares entra a la papelera (eliminación lógica) igual que
--      solicitudes_compra, proveedores y documentos (migración 0051): la app
--      no puede borrar (DELETE revocado) y varios módulos (Trabajo, horas,
--      quórum de asambleas, reuniones) listan o cuentan TODOS los núcleos
--      familiares. Con la columna eliminado_en y la política de aislamiento,
--      un núcleo dado de baja (por ejemplo, de prueba) deja de aparecer en
--      todos esos módulos sin tocar ninguna de sus consultas, y se puede
--      restaurar. Solo agrega columnas nullable y recrea la política con la
--      misma regla de cooperativa más el filtro.
--   5. comision_miembros: índice único (comisión, usuario) entre membresías
--      activas, para que la misma persona no figure dos veces en una
--      comisión. Solo se crea si hoy no hay duplicados (si los hubiera, la
--      migración no debe fallar: se deja sin índice y la aplicación igual
--      valida).

ALTER TABLE socios ADD COLUMN IF NOT EXISTS numero_nucleo INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_socios_org_numero_nucleo
  ON socios (organization_id, numero_nucleo)
  WHERE numero_nucleo IS NOT NULL AND estado <> 'baja';

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS estado_cuenta TEXT NOT NULL DEFAULT 'activa'; -- activa | pendiente

CREATE TABLE IF NOT EXISTS respaldos_limpieza (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  motivo TEXT NOT NULL,
  creado_por_id INTEGER REFERENCES users(id),
  contenido JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restaurado_en TIMESTAMPTZ
);

-- Papelera para nucleos_familiares (ver punto 4 de la cabecera).
ALTER TABLE nucleos_familiares ADD COLUMN IF NOT EXISTS eliminado_en TEXT;
ALTER TABLE nucleos_familiares ADD COLUMN IF NOT EXISTS eliminado_por_id INTEGER REFERENCES users(id);
ALTER TABLE nucleos_familiares ADD COLUMN IF NOT EXISTS motivo_eliminacion TEXT;

DO $$
BEGIN
  ALTER TABLE nucleos_familiares ENABLE ROW LEVEL SECURITY;
  ALTER TABLE nucleos_familiares FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON nucleos_familiares;
  CREATE POLICY tenant_isolation ON nucleos_familiares
    USING (
      organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int
      AND (eliminado_en IS NULL OR current_setting('app.incluir_eliminados', true) = '1')
    )
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

CREATE INDEX IF NOT EXISTS idx_respaldos_limpieza_org ON respaldos_limpieza (organization_id);

DO $$
BEGIN
  ALTER TABLE respaldos_limpieza ENABLE ROW LEVEL SECURITY;
  ALTER TABLE respaldos_limpieza FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON respaldos_limpieza;
  CREATE POLICY tenant_isolation ON respaldos_limpieza
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON respaldos_limpieza TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM comision_miembros WHERE activo = 1
    GROUP BY comision_id, user_id HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_comision_miembros_activos
      ON comision_miembros (comision_id, user_id) WHERE activo = 1;
  END IF;
END $$;
