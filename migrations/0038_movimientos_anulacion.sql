-- Fase 4 ("Seguridad y permisos granulares(16) + Seguridad de cuentas/2FA/
-- sesiones(17) + Eliminación segura(18)") — Sub-fase 4.4: Eliminación segura
-- de movimientos financieros (sección 18, última de las 5 sub-fases de esta
-- fase — texto original irrecuperable, mismo problema de siempre; alcance
-- confirmado con el usuario antes de escribir código).
--
-- Auditoría previa: "eliminar" un movimiento hoy hace un DELETE físico de
-- verdad sobre movimientos_financieros o movimientos_cuenta_socio, sin
-- chequear si algo más depende de ese registro (ej. un gasto de comisión ya
-- pagado que generó ese mismo movimiento vía gastos_comision.
-- movimiento_financiero_id, ver migrations/0017_gastos_comision.sql) y sin
-- ninguna restricción de rol más allá de canEdit(rol,"finanzas") — hoy
-- pueden borrar administración, tesorería, consejo directivo Y admin. El
-- resto del sistema ya resuelve "eliminar" con una baja lógica (estado, no
-- DELETE) en vez de un borrado real — ver gastos_comision.estado
-- ('pendiente'|'pagado'|'anulado', migrations/0017) como precedente directo:
-- un gasto ya pagado no se anula, se corrige con un ajuste. Esta migración
-- extiende el MISMO patrón (estado + quién/cuándo/por qué) a los dos
-- lugares que hoy hacen el borrado sin ese resguardo.
--
-- Nullable/DEFAULT 'activo' a propósito: todo movimiento existente hasta hoy
-- queda 'activo' automáticamente (Postgres completa el DEFAULT en las filas
-- ya existentes al agregar la columna), sin ningún backfill manual y sin
-- cambiar el saldo de nadie. anulado_en/anulado_por_id/motivo_anulacion
-- quedan NULL hasta que alguien anule un movimiento por primera vez.
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo'; -- activo | anulado
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMPTZ;
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS anulado_por_id INTEGER REFERENCES users(id);
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo'; -- activo | anulado
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMPTZ;
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS anulado_por_id INTEGER REFERENCES users(id);
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

CREATE INDEX IF NOT EXISTS idx_movimientos_financieros_estado ON movimientos_financieros (estado);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_estado ON movimientos_cuenta_socio (estado);
