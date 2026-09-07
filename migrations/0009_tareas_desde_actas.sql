-- Fase 09 del Plan Maestro — cerrar el círculo de "Reuniones y actas": ya se
-- genera agenda, asistencia y el PDF del acta (ver 0c5d882); falta que el
-- acta pueda dejar tareas resultantes cargadas automáticamente, en vez de
-- que alguien tenga que copiarlas a mano a Comisiones después.
--
-- La tabla "tareas" (Fase 06, migración 0008) exige comision_id porque nació
-- pensada para tareas cargadas desde la pantalla de una comisión puntual.
-- Pero una reunión de tipo asamblea o consejo_directivo no tiene comisión
-- asociada (reuniones.comision_id es nulo salvo tipo='comision') y su acta
-- igual puede dejar pendientes ("enviar comunicado a los socios", "pedir
-- presupuesto a tal proveedor"). Esta migración:
--
--   1) relaja tareas.comision_id a NULL (ya no es obligatorio), y
--   2) agrega tareas.reunion_id, para saber de qué reunión/acta salió una
--      tarea cuando corresponda.
--
-- Una tarea generada desde una reunión de comisión queda con AMBOS
-- comision_id y reunion_id cargados, así sigue apareciendo en Comisiones
-- (Fase 06) y además queda trazada a su acta de origen.

ALTER TABLE tareas ALTER COLUMN comision_id DROP NOT NULL;
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS reunion_id INTEGER REFERENCES reuniones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tareas_reunion ON tareas (reunion_id);

INSERT INTO schema_migrations (filename) VALUES ('0009_tareas_desde_actas.sql') ON CONFLICT (filename) DO NOTHING;
