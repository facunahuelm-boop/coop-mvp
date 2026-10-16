-- 0076 — El vaciado de datos de prueba no debe borrar la configuración de finanzas.
--
-- 0074 vació también cuentas_financieras, fondos, mapeo_contable y conceptos_cuota:
-- son configuración (dónde está la plata, para qué, plan de cuentas del contador y
-- los conceptos de cuota), no datos de prueba. Sin cuentas la pantalla de Finanzas
-- queda sin dónde cargar los saldos.
--
--  1) coova_tablas_vaciables() pasa a conservar esas cuatro tablas.
--  2) Se restauran, desde el último respaldo de vaciado que las tenga, en las
--     cooperativas donde hoy están vacías (no pisa nada si ya hay filas).

CREATE OR REPLACE FUNCTION coova_tablas_vaciables() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(c.table_name::text ORDER BY c.table_name), ARRAY[]::text[])
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
   WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND t.table_type = 'BASE TABLE'
     AND c.table_name <> ALL (ARRAY[
       'accesos_delegados','auditoria','checklist_ingreso','comision_miembros','comisiones','config_email',
       'configuracion_reglas','consejo_directivo_cargos','documento_categorias','espacios_comunes',
       'formatos_extracto','habilidades_nucleo','importaciones','login_intentos','nucleos_familiares',
       'plantillas_texto','reglas_automaticas','respaldos_limpieza','sessions','socio_estados',
       'socio_integrantes','socios','users','viviendas',
       'cuentas_financieras','fondos','mapeo_contable','conceptos_cuota'
     ]);
$$;

-- Se fija la cooperativa en cada vuelta (Row-Level Security forzada).
DO $$
DECLARE
  o RECORD;
  t text;
  r RECORD;
  n integer;
BEGIN
  FOR o IN SELECT id FROM organizations ORDER BY id LOOP
    PERFORM set_config('app.current_org_id', o.id::text, true);
    FOREACH t IN ARRAY ARRAY['cuentas_financieras','fondos','mapeo_contable','conceptos_cuota'] LOOP
      SELECT id, contenido INTO r
        FROM respaldos_limpieza
       WHERE organization_id = o.id AND contenido->>'tipo' = 'vaciado' AND contenido->'tablas' ? t
       ORDER BY id DESC LIMIT 1;
      IF FOUND THEN
        EXECUTE format('SELECT count(*) FROM %I WHERE organization_id = $1', t) INTO n USING o.id;
        IF n = 0 THEN
          EXECUTE format('INSERT INTO %1$I SELECT * FROM jsonb_populate_recordset(NULL::%1$I, $1)', t)
            USING r.contenido->'tablas'->t;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
