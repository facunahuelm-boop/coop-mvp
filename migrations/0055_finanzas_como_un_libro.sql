-- 0055 — Fase 2A "Finanzas como un libro" (el tesorero y la Fiscal confían).
--
--  - cuentas_financieras: dónde está la plata (banco o caja). Cada movimiento
--    queda en una cuenta y se puede saber el saldo de cada una.
--  - fondos: para qué es la plata (obra, social, reserva, mantenimiento, caja
--    chica…). Cada movimiento queda en un fondo y hay saldo por fondo.
--  - periodos_financieros: cierre mensual. Estados abierto → cerrado
--    (tesorería) → visado (Fiscal). Un mes cerrado o visado queda BLOQUEADO en
--    la base (trigger): no se puede agregar, editar ni anular un movimiento
--    con fecha en ese mes. Las correcciones se hacen con un contra-movimiento
--    en un mes abierto (contra_de_id).
--  - compromisos_futuros pasa a tener estado (pendiente → facturado → pagado,
--    o cancelado) y puede venir de una compra aprobada; además puede ser un
--    ingreso esperado (ej. desembolso del préstamo) para el flujo de caja.
--  - facturas_proveedor: facturas a pagar con vencimiento. Al pagarla se
--    genera el egreso.
--  - mapeo_contable: cómo se llama cada rubro en el plan de cuentas del
--    contador (para la planilla de exportación). No es contabilidad completa.
--
-- Nada se borra. Todo lo existente queda en una "Cuenta principal" y un
-- "Fondo general" que se crean para cada cooperativa (se pueden renombrar).
-- Ningún mes queda cerrado: el bloqueo empieza cuando tesorería cierra uno.

CREATE TABLE IF NOT EXISTS cuentas_financieras (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'banco' CHECK (tipo IN ('banco', 'caja')),
  banco TEXT,
  referencia TEXT,
  saldo_inicial NUMERIC(14, 2) NOT NULL DEFAULT 0,
  predeterminada SMALLINT NOT NULL DEFAULT 0,
  para_efectivo SMALLINT NOT NULL DEFAULT 0,
  activa SMALLINT NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  creado_por_id INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_predeterminada ON cuentas_financieras (organization_id) WHERE predeterminada = 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_efectivo ON cuentas_financieras (organization_id) WHERE para_efectivo = 1;

CREATE TABLE IF NOT EXISTS fondos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'general' CHECK (tipo IN ('general', 'obra', 'social', 'reserva', 'mantenimiento', 'caja_chica', 'otro')),
  descripcion TEXT,
  saldo_inicial NUMERIC(14, 2) NOT NULL DEFAULT 0,
  predeterminado SMALLINT NOT NULL DEFAULT 0,
  recibe_cuotas SMALLINT NOT NULL DEFAULT 0,
  comision_id INTEGER REFERENCES comisiones(id),
  tope NUMERIC(14, 2),
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  creado_por_id INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fondo_predeterminado ON fondos (organization_id) WHERE predeterminado = 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fondo_cuotas ON fondos (organization_id) WHERE recibe_cuotas = 1;

CREATE TABLE IF NOT EXISTS periodos_financieros (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  periodo TEXT NOT NULL CHECK (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado', 'visado')),
  resumen JSONB,
  cerrado_en TEXT,
  cerrado_por_id INTEGER REFERENCES users(id),
  visado_en TEXT,
  visado_por_id INTEGER REFERENCES users(id),
  observacion_fiscal TEXT,
  observado_en TEXT,
  observado_por_id INTEGER REFERENCES users(id),
  reabierto_en TEXT,
  reabierto_por_id INTEGER REFERENCES users(id),
  motivo_reapertura TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_periodo_financiero ON periodos_financieros (organization_id, periodo);

CREATE TABLE IF NOT EXISTS facturas_proveedor (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  solicitud_compra_id INTEGER REFERENCES solicitudes_compra(id),
  compromiso_id INTEGER REFERENCES compromisos_futuros(id),
  documento_id INTEGER REFERENCES documentos(id),
  numero TEXT,
  fecha_emision TEXT,
  fecha_vencimiento TEXT,
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  categoria TEXT,
  descripcion TEXT,
  estado TEXT NOT NULL DEFAULT 'a_pagar' CHECK (estado IN ('a_pagar', 'pagada', 'anulada')),
  pagada_en TEXT,
  pagada_por_id INTEGER REFERENCES users(id),
  movimiento_financiero_id INTEGER REFERENCES movimientos_financieros(id),
  anulada_en TEXT,
  anulada_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  registrado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas_proveedor (organization_id, estado);

CREATE TABLE IF NOT EXISTS mapeo_contable (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  categoria TEXT NOT NULL,
  codigo TEXT,
  nombre_contable TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mapeo_contable ON mapeo_contable (organization_id, categoria);

-- Movimientos: cuenta, fondo, transferencias internas y contra-movimientos.
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS cuenta_id INTEGER REFERENCES cuentas_financieras(id);
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS fondo_id INTEGER REFERENCES fondos(id);
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS transferencia_id TEXT;
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS contra_de_id INTEGER REFERENCES movimientos_financieros(id);
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS factura_id INTEGER REFERENCES facturas_proveedor(id);
CREATE INDEX IF NOT EXISTS idx_mov_fin_cuenta ON movimientos_financieros (cuenta_id);
CREATE INDEX IF NOT EXISTS idx_mov_fin_fondo ON movimientos_financieros (fondo_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_fin_contra ON movimientos_financieros (contra_de_id) WHERE contra_de_id IS NOT NULL AND COALESCE(estado, 'activo') <> 'anulado';

-- Compromisos con ciclo de vida.
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'egreso';
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS solicitud_compra_id INTEGER REFERENCES solicitudes_compra(id);
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES proveedores(id);
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS fondo_id INTEGER REFERENCES fondos(id);
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS factura_id INTEGER REFERENCES facturas_proveedor(id);
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS movimiento_financiero_id INTEGER REFERENCES movimientos_financieros(id);
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS cerrado_en TEXT;
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS cerrado_por_id INTEGER REFERENCES users(id);
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS motivo_cierre TEXT;
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS creado_por_id INTEGER REFERENCES users(id);
ALTER TABLE compromisos_futuros ADD COLUMN IF NOT EXISTS creado_en TEXT DEFAULT (now()::text);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compromisos_estado_valido') THEN
    ALTER TABLE compromisos_futuros ADD CONSTRAINT compromisos_estado_valido CHECK (estado IN ('pendiente', 'facturado', 'pagado', 'cancelado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compromisos_tipo_valido') THEN
    ALTER TABLE compromisos_futuros ADD CONSTRAINT compromisos_tipo_valido CHECK (tipo IN ('egreso', 'ingreso'));
  END IF;
END $$;
-- Una compra aprobada genera como máximo un compromiso vigente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_compromiso_por_compra ON compromisos_futuros (solicitud_compra_id)
  WHERE solicitud_compra_id IS NOT NULL AND estado <> 'cancelado';

-- Presupuesto: se puede dar de baja una línea sin borrarla.
ALTER TABLE presupuesto_general ADD COLUMN IF NOT EXISTS activo SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE presupuesto_general ADD COLUMN IF NOT EXISTS actualizado_en TEXT DEFAULT (now()::text);

-- Aislamiento por cooperativa y sin DELETE para la app.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas_financieras', 'fondos', 'periodos_financieros', 'facturas_proveedor', 'mapeo_contable'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)
         WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)',
      t
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
      EXECUTE format('REVOKE DELETE ON %I FROM app_user', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
    REVOKE DELETE ON presupuesto_general FROM app_user;
    REVOKE DELETE ON compromisos_futuros FROM app_user;
  END IF;
END $$;

-- Cuenta principal y Fondo general para cada cooperativa; todo lo existente
-- queda ahí. Se fija la cooperativa en cada vuelta para que funcione igual con
-- o sin Row-Level Security forzada para el rol que corre la migración.
DO $$
DECLARE
  o RECORD;
  c_id INTEGER;
  f_id INTEGER;
BEGIN
  FOR o IN SELECT id FROM organizations ORDER BY id LOOP
    PERFORM set_config('app.current_org_id', o.id::text, true);
    SELECT id INTO c_id FROM cuentas_financieras WHERE organization_id = o.id AND predeterminada = 1 LIMIT 1;
    IF c_id IS NULL THEN
      INSERT INTO cuentas_financieras (organization_id, nombre, tipo, predeterminada)
      VALUES (o.id, 'Cuenta principal', 'banco', 1) RETURNING id INTO c_id;
    END IF;
    SELECT id INTO f_id FROM fondos WHERE organization_id = o.id AND predeterminado = 1 LIMIT 1;
    IF f_id IS NULL THEN
      INSERT INTO fondos (organization_id, nombre, tipo, descripcion, predeterminado, recibe_cuotas)
      VALUES (o.id, 'Fondo general', 'general', 'Toda la plata que no está separada para algo en particular.', 1, 1) RETURNING id INTO f_id;
    END IF;
    UPDATE movimientos_financieros SET cuenta_id = c_id WHERE organization_id = o.id AND cuenta_id IS NULL;
    UPDATE movimientos_financieros SET fondo_id = f_id WHERE organization_id = o.id AND fondo_id IS NULL;
  END LOOP;
  PERFORM set_config('app.current_org_id', '', true);
END $$;

-- Libro: cuenta y fondo por defecto, y meses cerrados bloqueados.
CREATE OR REPLACE FUNCTION coova_libro_movimiento_financiero() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  est TEXT;
  metodo TEXT;
  periodo_nuevo TEXT;
  periodo_viejo TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cuenta_id IS NULL AND NEW.movimiento_cuenta_socio_id IS NOT NULL THEN
      SELECT metodo_pago INTO metodo FROM movimientos_cuenta_socio WHERE id = NEW.movimiento_cuenta_socio_id;
      IF metodo = 'efectivo' THEN
        SELECT id INTO NEW.cuenta_id FROM cuentas_financieras
         WHERE organization_id = NEW.organization_id AND para_efectivo = 1 AND activa = 1 ORDER BY id LIMIT 1;
      END IF;
    END IF;
    IF NEW.cuenta_id IS NULL THEN
      SELECT id INTO NEW.cuenta_id FROM cuentas_financieras
       WHERE organization_id = NEW.organization_id AND predeterminada = 1 ORDER BY id LIMIT 1;
    END IF;
    IF NEW.fondo_id IS NULL AND NEW.movimiento_cuenta_socio_id IS NOT NULL THEN
      SELECT id INTO NEW.fondo_id FROM fondos
       WHERE organization_id = NEW.organization_id AND recibe_cuotas = 1 AND activo = 1 ORDER BY id LIMIT 1;
    END IF;
    IF NEW.fondo_id IS NULL THEN
      SELECT id INTO NEW.fondo_id FROM fondos
       WHERE organization_id = NEW.organization_id AND predeterminado = 1 ORDER BY id LIMIT 1;
    END IF;
  ELSE
    -- Cambios que no tocan la plata (ej. conciliación, versión) no se bloquean.
    IF (OLD.tipo, OLD.monto, OLD.fecha, OLD.categoria, OLD.descripcion, OLD.cuenta_id, OLD.fondo_id, COALESCE(OLD.estado, 'activo'))
       IS NOT DISTINCT FROM
       (NEW.tipo, NEW.monto, NEW.fecha, NEW.categoria, NEW.descripcion, NEW.cuenta_id, NEW.fondo_id, COALESCE(NEW.estado, 'activo')) THEN
      RETURN NEW;
    END IF;
    periodo_viejo := left(OLD.fecha, 7);
    SELECT estado INTO est FROM periodos_financieros WHERE organization_id = OLD.organization_id AND periodo = periodo_viejo;
    IF est IN ('cerrado', 'visado') THEN
      RAISE EXCEPTION 'PERIODO_CERRADO:%', periodo_viejo USING ERRCODE = 'P0001';
    END IF;
  END IF;
  periodo_nuevo := left(NEW.fecha, 7);
  SELECT estado INTO est FROM periodos_financieros WHERE organization_id = NEW.organization_id AND periodo = periodo_nuevo;
  IF est IN ('cerrado', 'visado') THEN
    RAISE EXCEPTION 'PERIODO_CERRADO:%', periodo_nuevo USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_libro_movimiento_financiero ON movimientos_financieros;
CREATE TRIGGER trg_libro_movimiento_financiero
  BEFORE INSERT OR UPDATE ON movimientos_financieros
  FOR EACH ROW EXECUTE FUNCTION coova_libro_movimiento_financiero();
