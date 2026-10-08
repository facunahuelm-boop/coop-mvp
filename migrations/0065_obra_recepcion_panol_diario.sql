-- 0065 — Fase 3C "Recepción de materiales, pañol y diario de obra".
--
--  - recepciones_material: lo que llegó a la obra (de una compra o no), con
--    el remito (número y foto), lo pedido contra lo recibido y las
--    diferencias. Se anula, no se borra.
--  - panol_items / panol_movimientos: el pañol (herramientas y materiales
--    guardados). El stock se calcula con los movimientos: entradas, salidas,
--    préstamos (hasta que se devuelven) y ajustes de inventario. Los
--    movimientos se anulan, no se borran.
--  - diario_obra / diario_obra_fotos: el diario de obra del día, con fotos.
-- No destructiva.

CREATE TABLE IF NOT EXISTS recepciones_material (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  solicitud_id INTEGER REFERENCES solicitudes_compra(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  fecha TEXT NOT NULL,
  material TEXT NOT NULL,
  unidad TEXT,
  cantidad_pedida REAL,
  cantidad_recibida REAL NOT NULL CHECK (cantidad_recibida >= 0),
  remito_numero TEXT,
  remito_foto_url TEXT,
  conforme SMALLINT NOT NULL DEFAULT 1,
  diferencias TEXT,
  panol_item_id INTEGER,
  recibido_por_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_recepciones_solicitud ON recepciones_material (solicitud_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_fecha ON recepciones_material (organization_id, fecha);

CREATE TABLE IF NOT EXISTS panol_items (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'material' CHECK (tipo IN ('herramienta', 'material')),
  unidad TEXT NOT NULL DEFAULT 'unidad',
  stock_minimo REAL NOT NULL DEFAULT 0,
  ubicacion TEXT,
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_panol_items_org ON panol_items (organization_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recepciones_material_panol_item_fkey') THEN
    ALTER TABLE recepciones_material ADD CONSTRAINT recepciones_material_panol_item_fkey FOREIGN KEY (panol_item_id) REFERENCES panol_items(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS panol_movimientos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  item_id INTEGER NOT NULL REFERENCES panol_items(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida', 'prestamo', 'ajuste')),
  cantidad REAL NOT NULL,
  fecha TEXT NOT NULL,
  persona TEXT,
  nucleo_id INTEGER REFERENCES nucleos_familiares(id),
  recepcion_id INTEGER REFERENCES recepciones_material(id),
  notas TEXT,
  devuelto_en TEXT,
  devuelto_recibido_por_id INTEGER REFERENCES users(id),
  registrado_por_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_panol_mov_item ON panol_movimientos (item_id);

CREATE TABLE IF NOT EXISTS diario_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  fecha TEXT NOT NULL,
  clima TEXT,
  personas INTEGER,
  trabajos TEXT NOT NULL,
  novedades TEXT,
  autor_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_diario_obra_fecha ON diario_obra (organization_id, fecha);

CREATE TABLE IF NOT EXISTS diario_obra_fotos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  entrada_id INTEGER NOT NULL REFERENCES diario_obra(id),
  foto_url TEXT NOT NULL,
  descripcion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_diario_fotos_entrada ON diario_obra_fotos (entrada_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['recepciones_material', 'panol_items', 'panol_movimientos', 'diario_obra', 'diario_obra_fotos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
      EXECUTE format('REVOKE DELETE ON %I FROM app_user', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
