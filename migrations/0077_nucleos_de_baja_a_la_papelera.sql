-- 0077 — Los núcleos dados de baja no tienen que aparecer en ningún lado.
--
-- Dar de baja un núcleo ponía el socio en estado 'baja' pero dejaba su núcleo
-- familiar visible, y seguía contando en Trabajo, horas, quórum de asambleas
-- (p. ej. "0/40 núcleos" con 29 en el padrón). Esta migración manda a la
-- papelera (eliminación lógica, reversible) los núcleos de socios en baja. De acá
-- en adelante la baja desde Plataforma lo hace sola.

DO $$
DECLARE
  o RECORD;
BEGIN
  FOR o IN SELECT id FROM organizations ORDER BY id LOOP
    PERFORM set_config('app.current_org_id', o.id::text, true);
    PERFORM set_config('app.incluir_eliminados', '1', true);
    UPDATE nucleos_familiares n
       SET eliminado_en = now()::text, motivo_eliminacion = 'Núcleo dado de baja'
     WHERE n.organization_id = o.id
       AND n.eliminado_en IS NULL
       AND EXISTS (SELECT 1 FROM socios s WHERE s.nucleo_id = n.id AND s.estado = 'baja')
       AND NOT EXISTS (SELECT 1 FROM socios s WHERE s.nucleo_id = n.id AND s.estado <> 'baja');
  END LOOP;
END $$;
