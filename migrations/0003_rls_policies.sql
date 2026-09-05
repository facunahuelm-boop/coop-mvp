-- Fase 0 — Fundaciones multi-tenant.
-- Activa Row-Level Security en las 28 tablas: la garantía real de que nunca
-- se mezclan datos entre cooperativas, incluso si una consulta de la
-- aplicación tuviera un error y no filtrara por cooperativa.
--
-- FORCE ROW LEVEL SECURITY es necesario además de ENABLE: sin él, Postgres
-- exime automáticamente al dueño de la tabla (normalmente el rol con el que
-- se conecta la aplicación) de las políticas — es un error común que deja la
-- protección sin efecto en la práctica.
--
-- La política usa app.current_org_id, la variable de sesión que fija
-- src/lib/db.ts en cada consulta a partir de la cooperativa activa
-- (src/lib/tenant.ts). Si esa variable no está fijada, current_setting(...)
-- devuelve NULL y la comparación es falsa para todas las filas: por diseño,
-- sin cooperativa activa no se ve ni se modifica ningún dato.

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
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tabla);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)
         WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)',
      tabla
    );
  END LOOP;
END $$;
