-- Sub-fase 1.1 del nuevo pedido de evolución de la plataforma (22/09):
-- "Centro Documental" — mejorar (no duplicar) el módulo Documentos ya
-- existente agregando estado, vencimiento y destacados.
--
-- Mismo patrón que la migración 0029: columnas nuevas, todas con DEFAULT o
-- nullable, sobre una tabla que ya existe y ya tiene datos reales en
-- producción — ningún documento cargado hasta hoy cambia de comportamiento
-- (todos quedan "vigente", sin vencimiento, sin destacar).
--
-- Por qué NO se guarda "vencido" como valor posible de `estado`: sería una
-- segunda fuente de verdad que un cron tendría que mantener sincronizada
-- contra fecha_vencimiento (mismo problema que ya se evitó con
-- solicitudes_comision.estado / estadoEfectivo() en
-- components/solicitudes/SolicitudStatus.tsx). En su lugar, "vencido" se
-- calcula al mostrar a partir de fecha_vencimiento — ver
-- estadoEfectivoDocumento() en components/documentos/DocumentoStatus.tsx.
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'vigente'; -- vigente|pendiente|archivado
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS fecha_vencimiento TEXT;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT false;
