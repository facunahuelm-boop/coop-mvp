-- Fase 05 del Plan Maestro — Socios, Viviendas y Lista de espera.
--
-- Hasta ahora la única noción de "socio" era un "núcleo familiar"
-- (nucleos_familiares), pensado para ayuda mutua, y un "usuario del sistema"
-- (users) para el que puede iniciar sesión. Eso deja afuera a alguien que es
-- socio de la cooperativa pero todavía no tiene (o no necesita) una cuenta
-- para entrar al sistema — el caso típico es un aspirante en lista de espera,
-- o un integrante del núcleo que no es quien opera el sistema.
--
-- Esta migración agrega una ficha de socio independiente de la cuenta de
-- acceso, más "viviendas" (que hoy no existe como concepto) y una lista de
-- espera de aspirantes. Los vínculos con nucleos_familiares y users son
-- opcionales (nullable) a propósito: una cooperativa puede seguir operando
-- solo con núcleos familiares si prefiere no usar Socios todavía.

CREATE TABLE IF NOT EXISTS viviendas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  numero TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en_obra', -- en_obra | terminada | ocupada
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (NOW()::text),
  UNIQUE (organization_id, numero)
);

CREATE TABLE IF NOT EXISTS socios (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  documento TEXT,
  email TEXT,
  telefono TEXT,
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | inactivo | baja
  vivienda_id INTEGER REFERENCES viviendas(id),
  nucleo_id INTEGER REFERENCES nucleos_familiares(id), -- vínculo opcional con el núcleo familiar existente
  user_id INTEGER REFERENCES users(id),                -- vínculo opcional si además tiene cuenta de acceso
  fecha_ingreso TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS lista_espera (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  documento TEXT,
  contacto TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'en_espera', -- en_espera | convocado | incorporado | retirado
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_viviendas_org ON viviendas (organization_id);
CREATE INDEX IF NOT EXISTS idx_socios_org ON socios (organization_id);
CREATE INDEX IF NOT EXISTS idx_socios_vivienda ON socios (vivienda_id);
CREATE INDEX IF NOT EXISTS idx_lista_espera_org ON lista_espera (organization_id);
CREATE INDEX IF NOT EXISTS idx_lista_espera_orden ON lista_espera (orden);

-- Row-Level Security, mismo criterio que migrations/0003_rls_policies.sql y 0004.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['viviendas', 'socios', 'lista_espera'];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tabla);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int) WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)',
      tabla
    );
  END LOOP;
END $$;

-- Ver nota en migrations/0004_comisiones_reuniones.sql: los permisos de
-- app_user se otorgan tabla por tabla, hace falta repetirlo para tablas nuevas.
GRANT SELECT, INSERT, UPDATE, DELETE ON viviendas, socios, lista_espera TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
