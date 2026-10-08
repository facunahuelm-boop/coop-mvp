-- 0068 — Fase 3F "Modo asamblea en vivo".
--
--  - reuniones.punto_actual_id: el punto del orden del día que se está
--    tratando, para mostrarlo en la pantalla del proyector.
-- No destructiva.

ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS punto_actual_id INTEGER REFERENCES reunion_agenda_items(id);
