-- Gastos por Comisión (pedido explícito): hasta ahora no existía ningún
-- lugar para registrar cuánto gasta cada comisión (Compras, Seguridad,
-- Administrativa, Trabajo, Obra, o cualquier otra que se cree) — el único
-- dinero que se registraba era manual, vía Finanzas → "Registrar
-- movimiento" (movimientos_financieros), sin ninguna relación con quién lo
-- gastó ni en qué proveedor.
--
-- Diseño (para no duplicar el libro contable que ya existe en
-- movimientos_financieros): esta tabla es el registro RICO del gasto —
-- comisión responsable, proveedor, forma de pago, estado, comprobante — y
-- SOLO cuando el gasto se marca como "pagado" se crea automáticamente la
-- fila correspondiente en movimientos_financieros (columna
-- movimiento_financiero_id acá abajo, guardada para trazabilidad). Así
-- Finanzas sigue siendo la única fuente de verdad del saldo real de la
-- cooperativa — nunca hay dos lugares sumando plata por separado — y un
-- gasto "pendiente" no infla el saldo hasta que efectivamente se paga.
--
-- categoria reutiliza el mismo criterio que ya usa Compras
-- (CATEGORIA_COMPRA_LABEL en src/lib/constants.ts: general | obra |
-- mantenimiento | administracion | espacios_comunes | otros) en vez de
-- inventar una clasificación paralela.
--
-- solicitud_compra_id es opcional: cuando un gasto viene del flujo ya
-- existente de Compras (solicitud → presupuestos → decisión), queda
-- vinculado a esa solicitud en vez de cargarse de cero; un gasto también se
-- puede cargar directo, sin pasar por ese flujo, para compras chicas del
-- día a día de la comisión.

CREATE TABLE IF NOT EXISTS gastos_comision (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  comision_id INTEGER NOT NULL REFERENCES comisiones(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  solicitud_compra_id INTEGER REFERENCES solicitudes_compra(id),
  descripcion TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'otros',
  fecha TEXT NOT NULL,
  importe REAL NOT NULL,
  forma_pago TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | pagado | anulado
  observaciones TEXT,
  comprobante_url TEXT,
  creado_por_id INTEGER NOT NULL REFERENCES users(id),
  movimiento_financiero_id INTEGER REFERENCES movimientos_financieros(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gastos_comision_org ON gastos_comision (organization_id, comision_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_gastos_comision_estado ON gastos_comision (organization_id, estado);
CREATE INDEX IF NOT EXISTS idx_gastos_comision_proveedor ON gastos_comision (proveedor_id);

DO $$
BEGIN
  ALTER TABLE gastos_comision ENABLE ROW LEVEL SECURITY;
  ALTER TABLE gastos_comision FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON gastos_comision;
  CREATE POLICY tenant_isolation ON gastos_comision
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON gastos_comision TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0017_gastos_comision.sql') ON CONFLICT (filename) DO NOTHING;
