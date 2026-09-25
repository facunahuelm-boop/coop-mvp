-- Fase 6 (Migración de datos Excel/CSV(30) + Reportes(31) + IA contextual
-- por módulo(29) + Centro de ayuda/tickets) — Sub-fase 6.1: Migración de
-- datos Excel/CSV (sección 30, primera de esta fase).
--
-- El texto original de la sección 30 está irrecuperable, mismo problema que
-- fases anteriores. Auditoría previa confirmó que NO existía ningún
-- mecanismo de importación en todo el sistema (ni librería instalada, ni
-- una sola pantalla de carga) — el único precedente era exportación
-- (gastos_comision, CSV de salida), nunca lectura de un archivo hacia
-- adentro. Alcance confirmado con el usuario: dos entidades primero, Padrón
-- de socios y Movimientos financieros históricos.
--
-- `importaciones`: un registro por cada archivo cargado con éxito (no por
-- fila) — nombre del archivo, cuántas filas tenía, cuántas se importaron y
-- cuántas quedaron afuera por error de validación. Sirve de auditoría de
-- "quién importó qué y cuándo" y de ancla para poder deshacer un lote
-- entero si alguien cargó el archivo equivocado (dos veces, con datos mal
-- tipeados, etc.).
--
-- `importacion_id` en `socios` y `movimientos_financieros`: NULLABLE a
-- propósito — toda fila cargada a mano (como hasta hoy) queda con NULL, y
-- solo las filas que vinieron de un archivo llevan el id del lote. Esto no
-- inventa un mecanismo de reversión nuevo: "deshacer una importación" (ver
-- deshacerImportacionAction en actions/importaciones.ts) reutiliza tal cual
-- los mecanismos de baja lógica que YA existen para cada tabla —
-- socios.estado='baja' (Fase 05 del Plan Maestro) y
-- movimientos_financieros.estado='anulado' (migración 0038, Sub-fase 4.4) —
-- aplicados en lote a todas las filas de un mismo importacion_id, nunca un
-- DELETE físico.
CREATE TABLE IF NOT EXISTS importaciones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tipo TEXT NOT NULL, -- socios | movimientos_financieros
  nombre_archivo TEXT NOT NULL,
  cantidad_filas INTEGER NOT NULL DEFAULT 0,      -- filas totales leídas del archivo
  cantidad_importadas INTEGER NOT NULL DEFAULT 0, -- filas efectivamente insertadas
  cantidad_errores INTEGER NOT NULL DEFAULT 0,    -- filas descartadas por error de validación
  estado TEXT NOT NULL DEFAULT 'completado', -- completado | deshecho
  deshecho_en TIMESTAMPTZ,
  deshecho_por_id INTEGER REFERENCES users(id),
  importado_por_id INTEGER NOT NULL REFERENCES users(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE socios ADD COLUMN IF NOT EXISTS importacion_id INTEGER REFERENCES importaciones(id);
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS importacion_id INTEGER REFERENCES importaciones(id);

CREATE INDEX IF NOT EXISTS idx_importaciones_org ON importaciones (organization_id);
CREATE INDEX IF NOT EXISTS idx_socios_importacion ON socios (importacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_financieros_importacion ON movimientos_financieros (importacion_id);

-- Row-Level Security, mismo criterio que todas las migraciones anteriores.
DO $$
BEGIN
  ALTER TABLE importaciones ENABLE ROW LEVEL SECURITY;
  ALTER TABLE importaciones FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON importaciones;
  CREATE POLICY tenant_isolation ON importaciones
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON importaciones TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
