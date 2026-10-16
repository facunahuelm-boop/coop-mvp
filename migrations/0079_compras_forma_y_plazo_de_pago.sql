-- 0079 — Compras: medio de pago, plazo, condición negociada y seguimiento del pago.
--
--  - presupuestos_proveedor: medio_pago, plazo_pago y condicion_pago (lo que ofrece cada
--    proveedor). forma_pago sigue guardando el texto resumido para lo que ya lo lee.
--  - solicitudes_compra: al aprobar la compra se copian del presupuesto elegido; después se
--    puede registrar el vencimiento, el estado del pago (pendiente / parcial / pagado), el
--    importe que queda por pagar y el N° de factura o recibo.
-- No destructiva.

ALTER TABLE presupuestos_proveedor ADD COLUMN IF NOT EXISTS medio_pago TEXT;
ALTER TABLE presupuestos_proveedor ADD COLUMN IF NOT EXISTS plazo_pago TEXT;
ALTER TABLE presupuestos_proveedor ADD COLUMN IF NOT EXISTS condicion_pago TEXT;

ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_medio TEXT;
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_plazo TEXT;
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_condicion TEXT;
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_vencimiento TEXT;
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_estado TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_pendiente NUMERIC(14, 2);
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_comprobante TEXT;
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS pago_actualizado_en TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'solicitudes_compra_pago_estado_chk') THEN
    ALTER TABLE solicitudes_compra ADD CONSTRAINT solicitudes_compra_pago_estado_chk CHECK (pago_estado IN ('pendiente', 'parcial', 'pagado'));
  END IF;
END $$;
