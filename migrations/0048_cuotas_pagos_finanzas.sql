-- Actualización "Gestión cooperativa integrada" (04/10) — Fase 1: cuotas,
-- morosidad e integración con Finanzas.
--
-- 100% aditiva: sólo agrega columnas opcionales (NULL / DEFAULT) y un índice.
-- Ningún registro existente cambia de valor ni de comportamiento:
--   - un pago viejo sin `cuota_id` se sigue repartiendo contra las cuotas más
--     antiguas primero, igual que siempre;
--   - un convenio viejo queda con `refinancia = false` (su comportamiento de
--     hoy, sin tocar);
--   - los ingresos que ya están cargados a mano en Finanzas no se tocan ni se
--     vinculan con nada (decisión del usuario: hoy los pagos de cuotas se
--     cargan en los dos lados, así que sumar los pagos VIEJOS a Finanzas los
--     contaría dos veces). Recién los pagos registrados de acá en adelante
--     generan su ingreso en Finanzas automáticamente.

-- Pago de una cuota: con qué medio se pagó, y (opcional) a qué cuota puntual
-- se aplica. Sin `cuota_id`, el pago cubre lo más antiguo primero.
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS metodo_pago TEXT; -- efectivo | transferencia | deposito | debito | otro
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS cuota_id INTEGER REFERENCES movimientos_cuenta_socio(id);

-- Cuota original incluida en un convenio que la refinancia: mientras ese
-- convenio rija, su deuda la representan las cuotas del convenio (no se
-- cuenta dos veces) y se muestra "En convenio".
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS en_convenio_id INTEGER REFERENCES convenios_pago(id);
-- Parte de esa cuota que pasó al convenio (lo que debía al refinanciarse). Lo
-- que ya se había pagado de esa cuota antes del convenio sigue contando como
-- pagado — sin esto, un pago parcial previo se descontaría dos veces.
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS monto_refinanciado NUMERIC;
ALTER TABLE convenios_pago ADD COLUMN IF NOT EXISTS refinancia BOOLEAN NOT NULL DEFAULT false;

-- Ingreso de Finanzas generado automáticamente por un pago de cuota. El
-- índice único garantiza, a nivel base, que un mismo pago NUNCA puede
-- aparecer dos veces como ingreso.
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS movimiento_cuenta_socio_id INTEGER REFERENCES movimientos_cuenta_socio(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_fin_pago_cuota_unico
  ON movimientos_financieros (movimiento_cuenta_socio_id)
  WHERE movimiento_cuenta_socio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_cuota ON movimientos_cuenta_socio (cuota_id);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_en_convenio ON movimientos_cuenta_socio (en_convenio_id);
