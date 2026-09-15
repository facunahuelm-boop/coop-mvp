-- Fase 1 del rediseño de Compras (pedido explícito, sección 2 y 20): la
-- categoría de una solicitud hoy es una lista fija de 6 valores
-- (CATEGORIA_COMPRA_LABEL) sin ningún lugar para precisar más ("Materiales
-- de obra" es una categoría demasiado amplia para "cemento" vs. "pintura").
-- El pedido pide explícitamente NO crear un árbol rígido de categorías: en
-- vez de eso, se agrega "subcategoria" como texto libre opcional, que
-- convive con la categoría fija de siempre sin reemplazarla ni exigir
-- ningún valor. Ninguna solicitud existente se ve afectada (columna
-- nullable, sin default que la complete a la fuerza).
--
-- "recurrente" (sección 20 del pedido): deja preparada la posibilidad de
-- marcar una solicitud como "esto se repite" (limpieza, papelería,
-- mantenimiento periódico) sin implementar todavía ninguna automatización
-- real — el propio pedido aclara "no hace falta implementar automatización
-- completa ahora, pero dejar preparada la arquitectura". Es sólo una bandera
-- (boolean, default false): no cambia ningún flujo existente hasta que una
-- fase futura decida qué hacer con ella.

ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS subcategoria TEXT;
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS recurrente BOOLEAN NOT NULL DEFAULT false;

INSERT INTO schema_migrations (filename) VALUES ('0025_compras_subcategoria_recurrente.sql') ON CONFLICT (filename) DO NOTHING;
