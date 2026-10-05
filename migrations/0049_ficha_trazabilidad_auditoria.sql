-- Actualización "Gestión cooperativa integrada" (04/10) — Fases 2, 3 y 4.
--
-- 100% aditiva: columnas opcionales (NULL) e índices; ningún dato existente
-- cambia. Más un REVOKE que sólo QUITA permisos de modificación sobre la
-- auditoría (no borra ni cambia ningún registro).

-- ---------- Fase 2: Ficha 360° del núcleo ----------
-- Documento relacionado con un núcleo/socio (comprobantes, papeles
-- administrativos). Opcional: un documento general sigue sin socio.
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS socio_id INTEGER REFERENCES socios(id);
CREATE INDEX IF NOT EXISTS idx_documentos_socio ON documentos (socio_id);

-- ---------- Fase 4: recorrido de una decisión ----------
-- Una "resolución" es un punto del orden del día de una reunión (asamblea,
-- consejo o comisión) con su resultado (reunion_agenda_items.resultado).
-- Desde ella se puede llevar el tema a otra reunión (ej. el Consejo toma una
-- resolución de la Asamblea), crear una tarea, una solicitud de compra o
-- vincular una decisión de comisión — sin duplicar nada: cada cosa sigue
-- viviendo en su propio módulo y sólo guarda de qué resolución salió.
ALTER TABLE reunion_agenda_items ADD COLUMN IF NOT EXISTS origen_item_id INTEGER REFERENCES reunion_agenda_items(id);
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS agenda_item_id INTEGER REFERENCES reunion_agenda_items(id);
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS decision_id INTEGER REFERENCES decisiones_comision(id);
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS agenda_item_id INTEGER REFERENCES reunion_agenda_items(id);
ALTER TABLE decisiones_comision ADD COLUMN IF NOT EXISTS agenda_item_id INTEGER REFERENCES reunion_agenda_items(id);
-- Registro del resultado final de la tarea, para cerrar el recorrido.
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS resultado TEXT;

CREATE INDEX IF NOT EXISTS idx_agenda_items_origen ON reunion_agenda_items (origen_item_id);
CREATE INDEX IF NOT EXISTS idx_tareas_agenda_item ON tareas (agenda_item_id);
CREATE INDEX IF NOT EXISTS idx_tareas_decision ON tareas (decision_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_compra_agenda_item ON solicitudes_compra (agenda_item_id);
CREATE INDEX IF NOT EXISTS idx_decisiones_comision_agenda_item ON decisiones_comision (agenda_item_id);

-- ---------- Fase 3: auditoría inmodificable ----------
-- La aplicación sólo AGREGA eventos a la auditoría; nunca los modifica ni
-- los borra (no hay ninguna pantalla ni acción que lo haga). Se le quita al
-- rol con el que corre la app (app_user) el permiso de UPDATE y DELETE sobre
-- esa tabla: aunque un error de programación o un pedido malicioso lo
-- intentara, la base lo rechaza. Sigue pudiendo leer e insertar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON auditoria FROM app_user;
  END IF;
END $$;
