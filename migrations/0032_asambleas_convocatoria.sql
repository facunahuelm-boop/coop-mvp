-- Sub-fase 1.3 ("Asambleas como módulo propio", 22/09): la tabla "reuniones"
-- ya tenía tipo='asamblea' con agenda, invitados, asistencia por núcleo
-- (reunion_asistencias, contra TODOS los núcleos de la cooperativa —
-- src/app/(app)/reuniones/[id]/page.tsx ya muestra "Asistencia por núcleo
-- (presentes/total)") y acta con folio (migración 0031). Lo único que le
-- faltaba a una Asamblea frente a una reunión de comisión cualquiera es la
-- FORMALIDAD DE LA CONVOCATORIA que exige la normativa — de ahí estas tres
-- columnas, nullable porque solo aplican cuando tipo='asamblea'.
--
-- A propósito NO se agrega ninguna columna de "quórum cumplido" ni
-- "padrón habilitado": el guardrail no-negociable de esta fase es que el
-- sistema NUNCA calcule ni declare si una asamblea cumple quórum — eso
-- depende de reglas estatutarias y legales que varían por cooperativa y que
-- este sistema no tiene por qué conocer ni arbitrar. El único dato que se
-- muestra es presentes/total núcleos, ya calculado desde antes, tal cual
-- está, sin ningún veredicto agregado encima.
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS tipo_asamblea TEXT; -- ordinaria | extraordinaria (null salvo tipo='asamblea')
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS convocatoria TEXT; -- primera | segunda (null salvo tipo='asamblea')
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS fecha_convocatoria TEXT; -- fecha en que se emitió/publicó la convocatoria, para mostrar la antelación real
