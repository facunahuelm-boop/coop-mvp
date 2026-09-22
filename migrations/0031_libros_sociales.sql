-- Sub-fase 1.2 ("Libros Sociales digitales", 22/09): la tabla "actas" ya
-- existía (organo: asamblea | consejo_directivo | comision) y ya se llena
-- sola al cerrar una reunión (ver cerrarReunionAction en actions/reuniones.ts)
-- — no se crea nada nuevo para "generar actas", solo se le agrega lo que le
-- falta para poder presentarlas como un LIBRO formal: un número de folio
-- correlativo e inmutable dentro de cada organismo (Asamblea y Consejo
-- Directivo llevan cada uno su propia numeración; las actas de comisiones
-- internas, organo='comision', no son un libro social exigido por la
-- normativa y quedan fuera — siguen existiendo igual en /reuniones y
-- /documentos, solo no llevan folio).
--
-- El folio se asigna en el momento de crear el acta (MAX(numero_libro)+1
-- para ese organo, misma idea que ya usan solicitudes_comision.numero y
-- decisiones_comision.numero), nunca se recalcula después — por eso hace
-- falta backfillear las actas que ya existen, en orden cronológico real
-- (fecha, luego id como desempate), para que el libro digital arranque
-- reflejando el orden en que las reuniones pasadas realmente ocurrieron.
ALTER TABLE actas ADD COLUMN IF NOT EXISTS numero_libro INTEGER;

DO $$
DECLARE
  fila RECORD;
  contador INTEGER;
  organo_actual TEXT;
BEGIN
  contador := 0;
  organo_actual := NULL;
  FOR fila IN
    SELECT id, organo
    FROM actas
    WHERE organo IN ('asamblea', 'consejo_directivo') AND numero_libro IS NULL
    ORDER BY organo ASC, fecha ASC, id ASC
  LOOP
    IF fila.organo IS DISTINCT FROM organo_actual THEN
      organo_actual := fila.organo;
      contador := 0;
    END IF;
    contador := contador + 1;
    UPDATE actas SET numero_libro = contador WHERE id = fila.id;
  END LOOP;
END $$;

-- Salvaguarda: si alguna vez dos actas del mismo organismo (en la misma
-- cooperativa) llegaran a calcular el mismo folio por una carrera entre dos
-- cierres simultáneos, esto lo rechaza con un error en vez de guardar un
-- libro con folios duplicados en silencio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_actas_folio_unico
  ON actas (organization_id, organo, numero_libro)
  WHERE numero_libro IS NOT NULL;
