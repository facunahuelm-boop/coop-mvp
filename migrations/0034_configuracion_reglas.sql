-- Fase 3 ("Reglas de la cooperativa, Estatuto/Reglamentos como
-- configuración, Motor de reglas evento-condición-acción", sección 37) —
-- Sub-fase 3.1: Reglas de la cooperativa (sección 12).
--
-- El texto original de las secciones 12/13/14 no se pudo recuperar (mismo
-- problema de pérdida por compactación que ya afectó a la sección 15/
-- Cumplimiento) y el usuario confirmó no tenerlo tampoco. Se le propuso un
-- alcance concreto y lo confirmó antes de escribir código: en vez de
-- inventar un sistema de "reglas" nuevo desde cero, esta sub-fase audita
-- qué umbrales de negocio ya existían HARDCODEADOS en el código (no
-- configurables por cooperativa) y los mueve a una tabla de configuración,
-- sin cambiar ningún comportamiento por defecto.
--
-- Se encontraron exactamente dos umbrales reales de este tipo, repetidos
-- en varios archivos porque no había un solo lugar de donde leerlos
-- (src/lib/logic.ts, src/lib/ia.ts, y las páginas de Cumplimiento,
-- Seguridad y Finanzas):
--   - "dias_alerta_vencimiento": a cuántos días de vencer un documento se
--     lo marca "por vencer" (hardcodeado en 5 lugares distintos como el
--     número 15).
--   - "porcentaje_desvio_presupuesto": qué % de desvío entre gasto real y
--     presupuestado dispara una alerta (hardcodeado en 2 lugares como 0.15).
--
-- A propósito NO se incluye acá el umbral de intentos de login fallidos
-- (MAX_INTENTOS en actions/auth.ts) — es una regla de seguridad de cuentas,
-- no una regla de gestión de la cooperativa, y le corresponde a la Fase 4
-- (sección 17, Seguridad de cuentas/2FA/sesiones), no a esta.
--
-- Mismo patrón clave/valor por cooperativa que ya usa `config_email`
-- (migraciones 0002/0014): una fila por regla, en vez de columnas fijas,
-- para poder agregar más reglas configurables en el futuro sin otra
-- migración. Cada cooperativa que no configure nada sigue usando
-- exactamente el valor por defecto actual (15 días / 15%) — ver
-- src/lib/reglas.ts.
CREATE TABLE IF NOT EXISTS configuracion_reglas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  clave TEXT NOT NULL, -- dias_alerta_vencimiento | porcentaje_desvio_presupuesto
  valor TEXT NOT NULL,
  actualizado_por_id INTEGER REFERENCES users(id),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, clave)
);

CREATE INDEX IF NOT EXISTS idx_configuracion_reglas_org ON configuracion_reglas (organization_id);

-- Row-Level Security, mismo criterio que todas las migraciones anteriores.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE configuracion_reglas ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE configuracion_reglas FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON configuracion_reglas';
  EXECUTE $sql$
    CREATE POLICY tenant_isolation ON configuracion_reglas
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
  $sql$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON configuracion_reglas TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
