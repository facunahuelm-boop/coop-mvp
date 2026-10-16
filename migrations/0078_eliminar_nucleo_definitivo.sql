-- 0078 — Eliminar definitivamente un núcleo dado de baja (con sus usuarios y registros asociados).
--
-- app_user no puede borrar (migración 0051). Esta función SECURITY DEFINER es el único
-- camino, y solo acepta núcleos que YA estén dados de baja (en la papelera o con todos sus
-- socios en baja) de la cooperativa activa de la sesión. Borra el núcleo, sus socios e
-- integrantes y todo lo que cuelgue de ellos (cuotas, pagos, horas, etc.); los usuarios
-- del núcleo (rol socio) se borran también y las referencias hacia ellos en registros de
-- otras personas (quién lo creó, etc.) pasan a quedar vacías. No guarda respaldo.

CREATE OR REPLACE FUNCTION coova_borrar_en_cascada(p_tabla regclass, p_ids integer[], p_anular_refs boolean, p_nivel integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fk record;
  hijos integer[];
  tiene_id boolean;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN; END IF;
  IF p_nivel > 12 THEN RAISE EXCEPTION 'Demasiados niveles de dependencias al borrar.'; END IF;

  FOR fk IN
    SELECT c.conrelid::regclass AS tabla, a.attname AS col, a.attnotnull AS obligatoria
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = p_tabla
  LOOP
    IF p_anular_refs AND NOT fk.obligatoria THEN
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = ANY($1)', fk.tabla, fk.col, fk.col) USING p_ids;
    ELSE
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = fk.tabla::text AND column_name = 'id') INTO tiene_id;
      IF tiene_id THEN
        EXECUTE format('SELECT COALESCE(array_agg(id), ARRAY[]::integer[]) FROM %s WHERE %I = ANY($1) AND NOT ($3 AND id = ANY($2))', fk.tabla, fk.col)
          INTO hijos USING p_ids, p_ids, (fk.tabla = p_tabla);
        IF array_length(hijos, 1) IS NOT NULL THEN
          PERFORM coova_borrar_en_cascada(fk.tabla, hijos, false, p_nivel + 1);
        END IF;
      END IF;
      EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', fk.tabla, fk.col) USING p_ids;
    END IF;
  END LOOP;
  EXECUTE format('DELETE FROM %s WHERE id = ANY($1)', p_tabla) USING p_ids;
END;
$$;

CREATE OR REPLACE FUNCTION eliminar_nucleo_definitivo(p_org integer, p_nucleo integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n record;
  socios_ids integer[];
  usuarios_ids integer[];
  integrantes_ids integer[];
BEGIN
  IF p_org IS NULL OR p_org <> NULLIF(current_setting('app.current_org_id', true), '')::int THEN
    RAISE EXCEPTION 'La cooperativa no coincide con la sesión.';
  END IF;
  PERFORM set_config('app.incluir_eliminados', '1', true);

  SELECT * INTO n FROM nucleos_familiares WHERE id = p_nucleo AND organization_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el núcleo.'; END IF;

  IF n.eliminado_en IS NULL AND (
       NOT EXISTS (SELECT 1 FROM socios s WHERE s.nucleo_id = p_nucleo AND s.estado = 'baja')
       OR EXISTS (SELECT 1 FROM socios s WHERE s.nucleo_id = p_nucleo AND s.estado <> 'baja')
     ) THEN
    RAISE EXCEPTION 'Solo se puede eliminar definitivamente un núcleo que ya está dado de baja.';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::integer[]) INTO socios_ids FROM socios WHERE nucleo_id = p_nucleo AND organization_id = p_org;
  SELECT COALESCE(array_agg(id), ARRAY[]::integer[]) INTO integrantes_ids FROM socio_integrantes WHERE socio_id = ANY(socios_ids);

  -- Usuarios del núcleo: solo rol socio y que no pertenezcan a otro núcleo activo.
  SELECT COALESCE(array_agg(DISTINCT u.id), ARRAY[]::integer[]) INTO usuarios_ids
    FROM users u
   WHERE u.organization_id = p_org AND u.rol = 'socio'
     AND (u.nucleo_id = p_nucleo OR u.id IN (SELECT user_id FROM socios WHERE id = ANY(socios_ids) AND user_id IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM socios s2 WHERE s2.user_id = u.id AND s2.nucleo_id <> p_nucleo);

  -- Los socios apuntan al usuario; se sueltan antes de borrar usuarios.
  UPDATE socios SET user_id = NULL WHERE id = ANY(socios_ids);

  PERFORM coova_borrar_en_cascada('socio_integrantes'::regclass, integrantes_ids, false);
  PERFORM coova_borrar_en_cascada('socios'::regclass, socios_ids, false);
  PERFORM coova_borrar_en_cascada('users'::regclass, usuarios_ids, true);
  PERFORM coova_borrar_en_cascada('nucleos_familiares'::regclass, ARRAY[p_nucleo], false);

  RETURN jsonb_build_object('socios', COALESCE(array_length(socios_ids, 1), 0), 'usuarios', COALESCE(array_length(usuarios_ids, 1), 0), 'integrantes', COALESCE(array_length(integrantes_ids, 1), 0));
END;
$$;

REVOKE ALL ON FUNCTION coova_borrar_en_cascada(regclass, integer[], boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION eliminar_nucleo_definitivo(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eliminar_nucleo_definitivo(integer, integer) TO app_user;
