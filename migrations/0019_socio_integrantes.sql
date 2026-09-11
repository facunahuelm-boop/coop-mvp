-- Integrantes del núcleo familiar del socio (pedido explícito): un socio de
-- la cooperativa no siempre es una sola persona — puede tener pareja,
-- hijos, u otros integrantes conviviendo. Hasta ahora cada persona sólo
-- podía cargarse como un "socio" totalmente independiente, sin ninguna
-- relación entre ellas.
--
-- Nota importante de diseño: la tabla "nucleos_familiares" que ya existe
-- NO es esto — es del módulo Trabajo (jornadas de ayuda mutua), sólo lleva
-- cuota social y horas acumuladas por núcleo, sin nombres ni datos
-- personales de nadie. Para no crear un segundo concepto de "núcleo" que
-- conviva confuso con ese, esta migración reutiliza el registro de "socio"
-- que YA es, en los hechos, la unidad familiar (vinculada a una vivienda):
-- el socio pasa a ser el titular, y esta tabla nueva cuelga los demás
-- integrantes de esa misma ficha. El padrón (/socios) no cambia su
-- estructura — sólo suma, por cada socio, la cantidad de integrantes y la
-- posibilidad de ver/agregar el detalle.

CREATE TABLE IF NOT EXISTS socio_integrantes (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  apellido TEXT,
  documento TEXT,
  fecha_nacimiento TEXT,
  telefono TEXT,
  email TEXT,
  -- pareja | hijo | hija | padre | madre | hermano | hermana | otro
  relacion TEXT NOT NULL DEFAULT 'otro',
  -- tipo_integrante separado de "relacion": distingue mayor/menor de edad a
  -- simple vista en el padrón sin tener que mirar la fecha de nacimiento.
  tipo_integrante TEXT NOT NULL DEFAULT 'adulto', -- adulto | menor
  observaciones TEXT,
  -- activo: sigue formando parte del núcleo; inactivo: se fue o se dio de
  -- baja — nunca se borra la fila, así no se pierde el historial de quién
  -- integró el núcleo en algún momento (mismo criterio que el resto del
  -- sistema: estados en vez de eliminar).
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | inactivo
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_socio_integrantes_org ON socio_integrantes (organization_id, socio_id);

DO $$
BEGIN
  ALTER TABLE socio_integrantes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE socio_integrantes FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON socio_integrantes;
  CREATE POLICY tenant_isolation ON socio_integrantes
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON socio_integrantes TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0019_socio_integrantes.sql') ON CONFLICT (filename) DO NOTHING;
