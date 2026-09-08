-- Fase D del rediseño (puntos 21-24 del pedido original): visibilidad de
-- módulos según la etapa de la cooperativa, con override manual, y
-- generalización de "Compras" más allá de la obra.
--
-- 1) organizations.modulos_override: guarda, por cooperativa, si un admin
--    forzó a mano el estado de un módulo que hoy depende de la etapa (obra,
--    trabajo, seguridad). Valores por módulo: "mostrar" | "ocultar" — si no
--    aparece la clave, se usa el default automático según la etapa (ver
--    Nav.tsx). Nunca borra nada: sólo cambia qué se ve en el menú.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS modulos_override JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2) solicitudes_compra.categoria: hasta ahora "Compras" asumía que todo lo
--    comprado era para la obra (el único campo de clasificación era "Etapa
--    de obra", de texto libre). Cooperativas en etapa "habitada" también
--    compran (mantenimiento, administración, espacios comunes), así que se
--    agrega una categoría explícita. Las solicitudes ya cargadas quedan
--    clasificadas como "obra" (que es lo que eran, dado que el sistema sólo
--    servía para eso hasta ahora) — no se pierde ni se reclasifica nada.
ALTER TABLE solicitudes_compra
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'obra';
-- categoria: general | obra | mantenimiento | administracion | espacios_comunes | otros
