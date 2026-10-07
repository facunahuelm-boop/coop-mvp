-- 0056 — Fase 2B "Conciliación bancaria".
--
--  - formatos_extracto: cómo leer el extracto de cada banco (qué columna es la
--    fecha, el concepto, el importe…). Se guarda una vez por cuenta y se usa
--    solo la próxima vez.
--  - extractos_bancarios: cada archivo importado (quién, cuándo, qué período).
--  - extracto_lineas: cada línea del extracto. Estados: pendiente → conciliada
--    (vinculada a un movimiento de COOVA) o ignorada (con motivo). La
--    propuesta automática (A9) se guarda en la línea: por código de pago,
--    por monto y fecha (±3 días) o como sugerencia; siempre la confirma una
--    persona (salvo que el reglamento pida confirmar solas las coincidencias
--    exactas por código).
--  - movimientos_financieros.conciliado_linea_id / conciliado_en: marca el
--    movimiento como conciliado. No toca la plata: el trigger de meses
--    cerrados (0055) lo permite aunque el mes esté cerrado.
-- No destructiva.

CREATE TABLE IF NOT EXISTS formatos_extracto (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  cuenta_id INTEGER NOT NULL REFERENCES cuentas_financieras(id),
  columnas JSONB NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (now()::text),
  actualizado_por_id INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_formato_extracto_cuenta ON formatos_extracto (cuenta_id);

CREATE TABLE IF NOT EXISTS extractos_bancarios (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  cuenta_id INTEGER NOT NULL REFERENCES cuentas_financieras(id),
  archivo_nombre TEXT,
  desde TEXT,
  hasta TEXT,
  lineas INTEGER NOT NULL DEFAULT 0,
  repetidas INTEGER NOT NULL DEFAULT 0,
  importado_por_id INTEGER REFERENCES users(id),
  importado_en TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE IF NOT EXISTS extracto_lineas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  extracto_id INTEGER NOT NULL REFERENCES extractos_bancarios(id),
  cuenta_id INTEGER NOT NULL REFERENCES cuentas_financieras(id),
  fecha TEXT NOT NULL,
  descripcion TEXT,
  referencia TEXT,
  monto NUMERIC(14, 2) NOT NULL,   -- positivo: entró a la cuenta; negativo: salió
  saldo NUMERIC(14, 2),            -- saldo que informa el banco (si viene en el archivo)
  huella TEXT NOT NULL,            -- para no importar dos veces la misma línea
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'conciliada', 'ignorada')),
  propuesta_tipo TEXT CHECK (propuesta_tipo IN ('codigo', 'monto_fecha', 'sugerencia')),
  propuesta_movimiento_id INTEGER REFERENCES movimientos_financieros(id),
  propuesta_socio_id INTEGER REFERENCES socios(id),
  movimiento_financiero_id INTEGER REFERENCES movimientos_financieros(id),
  conciliada_como TEXT,            -- codigo | monto_fecha | sugerencia | manual | pago_cuota | nuevo | automatica
  conciliado_por_id INTEGER REFERENCES users(id),
  conciliado_en TEXT,
  motivo_ignorada TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_extracto_linea_huella ON extracto_lineas (cuenta_id, huella);
CREATE INDEX IF NOT EXISTS idx_extracto_lineas_estado ON extracto_lineas (organization_id, cuenta_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS uq_extracto_linea_movimiento ON extracto_lineas (movimiento_financiero_id) WHERE movimiento_financiero_id IS NOT NULL;

ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS conciliado_linea_id INTEGER REFERENCES extracto_lineas(id);
ALTER TABLE movimientos_financieros ADD COLUMN IF NOT EXISTS conciliado_en TEXT;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['formatos_extracto', 'extractos_bancarios', 'extracto_lineas'] LOOP
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
  END IF;
END $$;
