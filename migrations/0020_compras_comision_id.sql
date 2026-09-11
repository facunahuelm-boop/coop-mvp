-- Conectar Compras con Comisiones de verdad (pedido explícito: "Cooperativa
-- → Comisión → Gasto → Proveedor → Movimiento financiero", no módulos
-- aislados). Hasta ahora solicitudes_compra.comision era un campo de texto
-- libre (la persona escribía "Comisión de Obra" a mano) sin ningún vínculo
-- real con la tabla comisiones — no había forma de sumar "cuánto compró
-- cada comisión" de manera confiable (errores de tipeo, mayúsculas
-- distintas, etc. contarían como comisiones diferentes).
--
-- comision_id es NULLABLE y NO reemplaza a la columna "comision" (texto)
-- que ya existe: las solicitudes viejas se quedan tal cual, mostrando su
-- texto de siempre; el formulario nuevo va a cargar comision_id (un
-- <select> real contra la tabla comisiones) y de paso sigue completando
-- "comision" con el nombre, así ninguna pantalla vieja que lea esa columna
-- se rompe.
--
-- condiciones en presupuestos_proveedor: campo que faltaba para comparar
-- presupuestos más allá de precio/plazo/forma de pago/garantía (pedido
-- explícito: "Calidad, Condiciones") — se suma como observación cualitativa
-- libre, sin inventar un sistema de puntaje que no se pidió.

ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS comision_id INTEGER REFERENCES comisiones(id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_compra_comision ON solicitudes_compra (comision_id);

ALTER TABLE presupuestos_proveedor ADD COLUMN IF NOT EXISTS condiciones TEXT;

INSERT INTO schema_migrations (filename) VALUES ('0020_compras_comision_id.sql') ON CONFLICT (filename) DO NOTHING;
