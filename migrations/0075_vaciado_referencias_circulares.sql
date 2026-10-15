-- 0075 — Vaciado de datos de prueba: resuelve las referencias circulares.
--
-- En la primera pasada quedaron sin borrar actas, reuniones y documentos
-- porque se apuntan entre sí (reuniones.acta_id, actas.documento_id,
-- documentos.reunion_id / reemplaza_a_id). Ahora el vaciado suelta esas cuatro
-- referencias antes de borrar (el respaldo ya las tiene) y la restauración las
-- vuelve a poner después de insertar. Función reemplazada; sin cambios de datos.

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

  PERFORM set_config('app.incluir_eliminados', '1', true);
  -- Referencias circulares: se sueltan (el respaldo conserva los valores).
  UPDATE reuniones SET acta_id = NULL WHERE organization_id = p_org AND acta_id IS NOT NULL;
  UPDATE actas SET documento_id = NULL WHERE organization_id = p_org AND documento_id IS NOT NULL;
  UPDATE documentos SET reunion_id = NULL, reemplaza_a_id = NULL WHERE organization_id = p_org AND (reunion_id IS NOT NULL OR reemplaza_a_id IS NOT NULL);

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
        EXECUTE format('INSERT INTO %I SELECT * FROM jsonb_populate_recordset(NULL::%I, $1) ON CONFLICT DO NOTHING', t, t)
          USING (SELECT COALESCE(jsonb_agg(CASE t
                   WHEN 'reuniones' THEN r - 'acta_id'
                   WHEN 'actas' THEN r - 'documento_id'
                   WHEN 'documentos' THEN r - 'reunion_id' - 'reemplaza_a_id'
                   ELSE r END), '[]'::jsonb)
                   FROM jsonb_array_elements(contenido->'tablas'->t) r);
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
  -- Se vuelven a poner las referencias circulares que se soltaron.
  UPDATE reuniones x SET acta_id = (r->>'acta_id')::int FROM jsonb_array_elements(COALESCE(contenido->'tablas'->'reuniones', '[]'::jsonb)) r
    WHERE x.id = (r->>'id')::int AND r->>'acta_id' IS NOT NULL;
  UPDATE actas x SET documento_id = (r->>'documento_id')::int FROM jsonb_array_elements(COALESCE(contenido->'tablas'->'actas', '[]'::jsonb)) r
    WHERE x.id = (r->>'id')::int AND r->>'documento_id' IS NOT NULL;
  UPDATE documentos x SET reunion_id = (r->>'reunion_id')::int, reemplaza_a_id = (r->>'reemplaza_a_id')::int FROM jsonb_array_elements(COALESCE(contenido->'tablas'->'documentos', '[]'::jsonb)) r
    WHERE x.id = (r->>'id')::int AND (r->>'reunion_id' IS NOT NULL OR r->>'reemplaza_a_id' IS NOT NULL);
  PERFORM set_config('app.incluir_eliminados', '1', true);
  UPDATE respaldos_limpieza SET restaurado_en = NOW() WHERE id = p_respaldo;
  RETURN restauradas;
END $$;

REVOKE ALL ON FUNCTION vaciar_datos_prueba(integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION restaurar_vaciado(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vaciar_datos_prueba(integer, integer, text) TO app_user;
GRANT EXECUTE ON FUNCTION restaurar_vaciado(integer, integer) TO app_user;
