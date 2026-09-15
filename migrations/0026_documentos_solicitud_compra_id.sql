-- Rediseño profundo de Compras, Fase 4 (pedido explícito, sección 21:
-- "facturas/documentos attachable from modal with Ver/Descargar, respetando
-- la estrategia de almacenamiento existente"). Hasta ahora `documentos` era
-- una biblioteca general por categoría, sin ningún vínculo con una compra
-- puntual (ver hallazgo documentado en el CHANGELOG, Fase 3). Esta columna,
-- nullable y sin CASCADE (mismo criterio del proyecto: nada se borra en
-- cascada sin que quede explícito en el código), permite adjuntar una
-- factura/comprobante a la solicitud de compra que la generó, sin romper
-- ningún documento existente (todos quedan con solicitud_compra_id = NULL,
-- exactamente como están hoy: documentos "sueltos" de la biblioteca general).
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS solicitud_compra_id INTEGER REFERENCES solicitudes_compra(id);

INSERT INTO schema_migrations (filename) VALUES ('0026_documentos_solicitud_compra_id.sql') ON CONFLICT (filename) DO NOTHING;
