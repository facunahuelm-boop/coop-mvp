-- Comisiones como áreas de trabajo (05/10) + Comisión de Trabajo: horas
-- semanales por núcleo.
--
-- 100% aditiva: columnas nuevas con default y una tabla nueva. Ninguna
-- comisión se borra ni cambia de nombre; ningún dato existente se pisa (el
-- único UPDATE completa la columna NUEVA `funcion`, que hasta ahora no
-- existía).

-- ---------- 1. Función de cada comisión ----------
-- Qué ES la comisión (trabajo | compras | seguridad | administrativa |
-- general). Define sus herramientas propias (ej. Trabajo → calendario de
-- horas) y en qué etapas de la cooperativa está disponible por defecto
-- (catálogo en src/lib/comisionesFunciones.ts, igual para todas las
-- cooperativas).
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS funcion TEXT NOT NULL DEFAULT 'general';
-- Etapas en las que se muestra, si la cooperativa quiere otra cosa que el
-- default de su función (ej. "pre_obra,obra"). NULL = usar el default.
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS etapas TEXT;

-- Decisión del usuario (05/10): las comisiones que ya existen se marcan por
-- su nombre; las demás quedan "general". Sólo toca filas que siguen en el
-- default, así que correr la migración dos veces no cambia nada que alguien
-- ya haya elegido a mano.
UPDATE comisiones SET funcion = 'trabajo'        WHERE funcion = 'general' AND nombre ILIKE '%trabajo%';
UPDATE comisiones SET funcion = 'compras'        WHERE funcion = 'general' AND nombre ILIKE '%compra%';
UPDATE comisiones SET funcion = 'seguridad'      WHERE funcion = 'general' AND nombre ILIKE '%seguridad%';
UPDATE comisiones SET funcion = 'administrativa' WHERE funcion = 'general' AND nombre ILIKE '%administra%';

-- ---------- 2. Horas de trabajo asignadas a cada núcleo ----------
-- Un tramo horario de un núcleo en un día concreto, dentro de una semana
-- concreta (`semana` = lunes, YYYY-MM-DD — las semanas no se mezclan).
-- `minutos` guarda el tiempo efectivo YA descontado el descanso (ej. 07:00
-- a 14:00 = 6 h = 360). El objetivo semanal de cada núcleo ya existía:
-- nucleos_familiares.horas_semanales_objetivo (default 21).
-- Cancelar una asignación es una baja lógica (estado = 'cancelada'): deja
-- de contar, pero queda en el historial.
CREATE TABLE IF NOT EXISTS asignaciones_horas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  comision_id INTEGER REFERENCES comisiones(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  semana TEXT NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT NOT NULL,
  minutos INTEGER NOT NULL,
  observaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'activa', -- activa | cancelada
  motivo_cancelacion TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  actualizado_en TEXT NOT NULL DEFAULT (now()::text),
  cancelado_en TEXT,
  cancelado_por_id INTEGER REFERENCES users(id)
);

DO $$
BEGIN
  ALTER TABLE asignaciones_horas ENABLE ROW LEVEL SECURITY;
  ALTER TABLE asignaciones_horas FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON asignaciones_horas;
  CREATE POLICY tenant_isolation ON asignaciones_horas
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON asignaciones_horas TO app_user;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_asignaciones_horas_semana ON asignaciones_horas (organization_id, semana);
CREATE INDEX IF NOT EXISTS idx_asignaciones_horas_nucleo_fecha ON asignaciones_horas (nucleo_id, fecha);
