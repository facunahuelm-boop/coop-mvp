-- Fase 0 — Fundaciones multi-tenant.
-- Agrega organization_id a las 28 tablas existentes, con los datos actuales
-- de UFAMA quedando asignados a la cooperativa "ufama" creada en 0001.
--
-- Se hace en un bloque PL/pgSQL en vez de 28 bloques repetidos a mano para
-- evitar errores de tipeo entre tabla y tabla — el tratamiento es idéntico
-- para las 28: agregar columna, completar con la cooperativa UFAMA, exigir
-- que no sea nula de acá en adelante, y agregar clave foránea + índice.

DO $$
DECLARE
  ufama_id INTEGER;
  tabla TEXT;
  tablas TEXT[] := ARRAY[
    'nucleos_familiares', 'users', 'sessions',
    'tareas_obra', 'avances_obra', 'problemas_obra',
    'jornadas_trabajo', 'tareas_jornada', 'asignaciones_jornada', 'asistencias', 'habilidades_nucleo',
    'proveedores', 'solicitudes_compra', 'presupuestos_proveedor', 'decisiones_compra',
    'documentos_seguridad', 'inspecciones_seguridad', 'incidentes_seguridad',
    'movimientos_financieros', 'presupuesto_general', 'compromisos_futuros',
    'documentos', 'actas',
    'alertas', 'auditoria', 'reportes_generados',
    'config_email', 'alertas_email'
  ];
BEGIN
  SELECT id INTO ufama_id FROM organizations WHERE slug = 'ufama';
  IF ufama_id IS NULL THEN
    RAISE EXCEPTION 'No existe la cooperativa "ufama" — correr primero 0001_organizations.sql';
  END IF;

  FOREACH tabla IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id INTEGER', tabla);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', tabla) USING ufama_id;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', tabla);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = tabla || '_organization_id_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id)',
        tabla, tabla || '_organization_id_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- Los índices van fuera del bloque anterior porque CREATE INDEX no admite
-- EXCEPTION por tabla individual de forma prolija dentro del mismo LOOP.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY[
    'nucleos_familiares', 'users', 'sessions',
    'tareas_obra', 'avances_obra', 'problemas_obra',
    'jornadas_trabajo', 'tareas_jornada', 'asignaciones_jornada', 'asistencias', 'habilidades_nucleo',
    'proveedores', 'solicitudes_compra', 'presupuestos_proveedor', 'decisiones_compra',
    'documentos_seguridad', 'inspecciones_seguridad', 'incidentes_seguridad',
    'movimientos_financieros', 'presupuesto_general', 'compromisos_futuros',
    'documentos', 'actas',
    'alertas', 'auditoria', 'reportes_generados',
    'config_email', 'alertas_email'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)', 'idx_' || tabla || '_org', tabla);
  END LOOP;
END $$;

-- Los emails y las claves de configuración de email dejan de ser únicos
-- globalmente y pasan a ser únicos por cooperativa (dos cooperativas
-- distintas ya no deberían chocar si, por lo que sea, comparten un email).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ADD CONSTRAINT users_org_email_unique UNIQUE (organization_id, email);

ALTER TABLE config_email DROP CONSTRAINT IF EXISTS config_email_clave_key;
ALTER TABLE config_email ADD CONSTRAINT config_email_org_clave_unique UNIQUE (organization_id, clave);
