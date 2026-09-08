-- Reclamos y Mantenimiento (Dashboard: prioridad y simplicidad, punto 6 del
-- rediseño — ver dashboard/page.tsx). Tiene sentido sobre todo una vez que la
-- cooperativa está habitada (ver moduloVisible() en Nav.tsx, que la muestra
-- por defecto sólo en esa etapa, igual que "obra"/"trabajo"/"seguridad" hacen
-- lo contrario), pero la tabla no depende de la etapa: un admin puede
-- forzarla visible antes desde Configuración → Módulos si le sirve.
--
-- A diferencia de "solicitudes_compra" (que arma una comisión), acá cualquier
-- socio necesita poder reportar un problema de su vivienda o de un espacio
-- común directamente — ver el comentario sobre el rol "socio" en
-- src/lib/roles.ts. "vivienda_id" es opcional: puede ser un reclamo sobre un
-- espacio común, no sobre una vivienda puntual.

CREATE TABLE IF NOT EXISTS reclamos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  vivienda_id INTEGER REFERENCES viviendas(id),
  categoria TEXT NOT NULL DEFAULT 'otros', -- filtracion | electricidad | plomeria | espacios_comunes | estructura | otros
  titulo TEXT NOT NULL,
  descripcion TEXT,
  prioridad TEXT NOT NULL DEFAULT 'media', -- baja | media | alta
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | en_proceso | resuelto
  foto_url TEXT,
  reportado_por_id INTEGER REFERENCES users(id),
  responsable_id INTEGER REFERENCES users(id),
  resolucion TEXT,
  fecha TEXT NOT NULL DEFAULT (NOW()::text),
  resuelto_en TEXT
);

CREATE INDEX IF NOT EXISTS idx_reclamos_org ON reclamos (organization_id);
CREATE INDEX IF NOT EXISTS idx_reclamos_estado ON reclamos (estado);
CREATE INDEX IF NOT EXISTS idx_reclamos_vivienda ON reclamos (vivienda_id);

-- Row-Level Security, mismo criterio que migrations/0006_socios_viviendas.sql.
DO $$
BEGIN
  ALTER TABLE reclamos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE reclamos FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON reclamos;
  CREATE POLICY tenant_isolation ON reclamos
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

-- Ver nota en migrations/0004_comisiones_reuniones.sql: los permisos de
-- app_user se otorgan tabla por tabla, hace falta repetirlo para tablas nuevas.
GRANT SELECT, INSERT, UPDATE, DELETE ON reclamos TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0012_reclamos.sql') ON CONFLICT (filename) DO NOTHING;
