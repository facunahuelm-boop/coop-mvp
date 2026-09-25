-- Rediseño del Calendario, Etapa 1 (pedido explícito, 25/09): convertir las
-- "notas de calendario" (migración 0015, texto+categoría nada más) en una
-- "actividad" mucho más rica — con responsable, comisión, ubicación, todo el
-- día, participantes y recordatorio, todos opcionales. Se AMPLÍA la tabla
-- existente en vez de crear una paralela (pedido explícito, punto 28: "si ya
-- existe una tabla/estructura de eventos, reutilizarla y ampliarla").
--
-- Los eventos de solo lectura que ya arma el calendario agregando reuniones/
-- jornadas_trabajo/tareas_obra/compromisos_futuros/documentos_seguridad NO se
-- tocan acá — siguen viniendo de sus propias tablas, sin ningún cambio. Esta
-- migración es exclusivamente sobre las actividades manuales.
--
-- "color" (la columna que ya existía, migración 0015) sigue funcionando
-- exactamente igual que hasta ahora — se sigue usando para guardar la
-- CATEGORÍA de la actividad (ver src/lib/calendarCategories.ts), no un color
-- literal; ver el comentario de esa migración y de calendarioNotas.ts para el
-- porqué de ese nombre. Lo único que cambia en esa columna es que deja de ser
-- NOT NULL: el pedido exige que la categoría sea opcional ("no obligar a
-- elegir categoría" — punto 8), algo que la tabla no permitía hasta ahora.
ALTER TABLE notas_calendario ALTER COLUMN color DROP NOT NULL;
ALTER TABLE notas_calendario ALTER COLUMN color DROP DEFAULT;

-- Responsable y comisión: mismo patrón ya usado en el resto del sistema
-- (users/comisiones por id, nullable = opcional). Sin ON DELETE CASCADE a
-- propósito: si se borra un usuario o una comisión, la actividad debe seguir
-- existiendo (con el responsable/comisión quedando "sin asignar" al leerla,
-- resuelto en el JOIN de la consulta, no acá) — mismo criterio de no perder
-- información histórica que ya se aplica en el resto del sistema.
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS responsable_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS comision_id INTEGER REFERENCES comisiones(id) ON DELETE SET NULL;

-- Ubicación: texto libre y opcional (punto 24 del pedido).
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS ubicacion TEXT;

-- "Todo el día" (punto 11): cuando es true, "hora" se ignora/queda en NULL —
-- validado en la Server Action, no acá.
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS todo_el_dia BOOLEAN NOT NULL DEFAULT false;

-- Color elegible sólo para categoría "personalizada" (punto 7): siete valores
-- posibles (verde/azul/violeta/amarillo/naranja/rojo/gris), validados en la
-- Server Action — TEXT sin CHECK, mismo criterio que la columna "color" de
-- arriba (evita una migración extra si el catálogo de colores cambia).
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS color_personalizado TEXT;

-- Participantes (punto 20) queda deliberadamente FUERA de esta Etapa 1: no
-- hay ningún precedente en insert()/update() (src/lib/db.ts) de escribir una
-- columna array de la aplicación — ambos helpers convierten a JSON.stringify
-- cualquier valor `object` (pensado para JSONB, no para un ARRAY nativo de
-- Postgres), así que necesitaría un camino de escritura aparte sin precedente
-- todavía probado en este proyecto. Además, "participantes" tiene más sentido
-- construido junto con "Mi agenda" (Etapa 4 de este mismo rediseño) — ahí sí
-- hace falta poder responder "¿en qué actividades participo?", que es
-- exactamente lo que esta columna serviría. Se agrega en esa etapa.

-- Recordatorio (punto 21): sólo se guarda la preferencia en esta Etapa 1, sin
-- disparo real todavía (decisión confirmada con el usuario) — el disparo real
-- vía Vercel Cron queda para una etapa aparte de este mismo rediseño.
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS recordatorio TEXT;

INSERT INTO schema_migrations (filename) VALUES ('0042_actividades_calendario.sql') ON CONFLICT (filename) DO NOTHING;
