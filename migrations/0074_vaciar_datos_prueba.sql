-- 0074 — Vaciado de datos de prueba de una cooperativa (con respaldo y restauración).
--
-- app_user no puede borrar (migración 0051). Para dejar una cooperativa limpia
-- antes de cargar los datos reales, dos funciones SECURITY DEFINER hacen el
-- trabajo bajo control:
--   vaciar_datos_prueba(org): copia TODAS las filas a borrar a respaldos_limpieza
--     (JSON) y recién después las borra. Conserva usuarios, socios, núcleos,
--     comisiones e integrantes, configuración y auditoría.
--   restaurar_vaciado(org, respaldo): vuelve a insertar lo respaldado.
-- Solo opera sobre la cooperativa activa de la sesión (app.current_org_id).

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
       'socio_integrantes','socios','users','viviendas'
     ]);
$$;

CREATE OR REPLACE FUNCTION vaciar_datos_prueba(p_org integer, p_usuario integer, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tablas text[] := coova_tablas_vaciables();
  t text;
  filas jsonb;
  respaldo jsonb := '{}'::jsonb;
  pendientes text[];
  siguiente text[];
  progreso boolean;
  borradas jsonb := '{}'::jsonb;
  n integer;
  resp_id integer;
BEGIN
  IF p_org IS NULL OR p_org <> NULLIF(current_setting('app.current_org_id', true), '')::int THEN
    RAISE EXCEPTION 'La cooperativa no coincide con la sesión.';
  END IF;

  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) FROM %I x WHERE organization_id = $1', t) INTO filas USING p_org;
    IF jsonb_array_length(filas) > 0 THEN respaldo := respaldo || jsonb_build_object(t, filas); END IF;
  END LOOP;

  INSERT INTO respaldos_limpieza (organization_id, motivo, creado_por_id, contenido)
  VALUES (p_org, p_motivo, p_usuario, jsonb_build_object('tipo', 'vaciado', 'tablas', respaldo))
  RETURNING id INTO resp_id;

  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO pendientes FROM jsonb_object_keys(respaldo) k;
  LOOP
    progreso := false;
    siguiente := ARRAY[]::text[];
    FOREACH t IN ARRAY pendientes LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE organization_id = $1', t) USING p_org;
        GET DIAGNOSTICS n = ROW_COUNT;
        borradas := borradas || jsonb_build_object(t, n);
        progreso := true;
      EXCEPTION WHEN foreign_key_violation THEN
        siguiente := siguiente || t;
      END;
    END LOOP;
    pendientes := siguiente;
    EXIT WHEN NOT progreso OR array_length(pendientes, 1) IS NULL;
  END LOOP;

  RETURN jsonb_build_object('respaldo_id', resp_id, 'borradas', borradas, 'omitidas', to_jsonb(pendientes));
END $$;

CREATE OR REPLACE FUNCTION restaurar_vaciado(p_org integer, p_respaldo integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  contenido jsonb;
  ya timestamptz;
  pendientes text[];
  siguiente text[];
  progreso boolean;
  t text;
  restauradas jsonb := '{}'::jsonb;
BEGIN
  IF p_org IS NULL OR p_org <> NULLIF(current_setting('app.current_org_id', true), '')::int THEN
    RAISE EXCEPTION 'La cooperativa no coincide con la sesión.';
  END IF;
  SELECT r.contenido, r.restaurado_en INTO contenido, ya FROM respaldos_limpieza r WHERE r.id = p_respaldo AND r.organization_id = p_org;
  IF contenido IS NULL THEN RAISE EXCEPTION 'Ese respaldo no existe.'; END IF;
  IF ya IS NOT NULL THEN RAISE EXCEPTION 'Ese respaldo ya se restauró.'; END IF;
  IF contenido->>'tipo' <> 'vaciado' THEN RAISE EXCEPTION 'Ese respaldo no es de un vaciado.'; END IF;

  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO pendientes FROM jsonb_object_keys(contenido->'tablas') k;
  LOOP
    progreso := false;
    siguiente := ARRAY[]::text[];
    FOREACH t IN ARRAY pendientes LOOP
      BEGIN
        EXECUTE format('INSERT INTO %I SELECT * FROM jsonb_populate_recordset(NULL::%I, $1) ON CONFLICT DO NOTHING', t, t) USING contenido->'tablas'->t;
        restauradas := restauradas || jsonb_build_object(t, jsonb_array_length(contenido->'tablas'->t));
        progreso := true;
      EXCEPTION WHEN foreign_key_violation THEN
        siguiente := siguiente || t;
      END;
    END LOOP;
    pendientes := siguiente;
    EXIT WHEN NOT progreso OR array_length(pendientes, 1) IS NULL;
  END LOOP;
  IF array_length(pendientes, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'No se pudo restaurar %: faltan datos de los que depende.', array_to_string(pendientes, ', ');
  END IF;
  UPDATE respaldos_limpieza SET restaurado_en = NOW() WHERE id = p_respaldo;
  RETURN restauradas;
END $$;

REVOKE ALL ON FUNCTION vaciar_datos_prueba(integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION restaurar_vaciado(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vaciar_datos_prueba(integer, integer, text) TO app_user;
GRANT EXECUTE ON FUNCTION restaurar_vaciado(integer, integer) TO app_user;
