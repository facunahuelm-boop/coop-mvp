-- Rediseño del Calendario, Etapa 5 (26/09, última etapa del pedido original
-- de 32 puntos): recordatorios reales vía Vercel Cron. Decisiones confirmadas
-- con el usuario antes de esta migración:
--   1) Frecuencia del cron: 1 vez al día (plan Hobby de Vercel, gratis) — NO
--      cada pocos minutos (eso requeriría plan Pro). Consecuencia aceptada
--      explícitamente: se pierde la precisión de las 6 opciones de
--      "recordatorio" (5min/15min/30min/1hora/1día antes) — el cron diario
--      avisa de TODAS las actividades de "hoy" que tengan cualquier opción
--      distinta de "ninguno", sin distinguir cuál eligió cada una.
--   2) Destinatarios: autor + responsable + participantes de la actividad
--      (el mismo conjunto "esMia" ya construido en la Etapa 4), no sólo el
--      autor.
--   3) Canal: email únicamente (no notificación en la campanita) — un
--      recordatorio tiene que llegar aunque la persona no tenga la app
--      abierta, que es exactamente el caso de uso.
--
-- Esta columna evita mandar el mismo recordatorio dos veces si el cron se
-- reintenta el mismo día (Vercel puede reintentar una invocación fallida) —
-- no hace falta ninguna tabla nueva porque cada ocurrencia de una serie
-- recurrente ya es su propia fila (ver Etapa 2), así que una sola columna de
-- "ya se mandó" por fila alcanza.
ALTER TABLE notas_calendario ADD COLUMN IF NOT EXISTS recordatorio_enviado_en TIMESTAMPTZ;

INSERT INTO schema_migrations (filename) VALUES ('0045_recordatorios_calendario.sql') ON CONFLICT (filename) DO NOTHING;
