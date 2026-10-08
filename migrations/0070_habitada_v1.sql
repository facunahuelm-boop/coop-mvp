-- 0070 — Fase 3H "Etapa Habitada v1".
--
--  - conceptos_cuota: cargos mensuales que se suman a la cuota social
--    (fondo de mantenimiento, gastos comunes, amortización…). Se desactivan,
--    no se borran.
--  - mantenimiento_preventivo / mantenimiento_registros: tareas que se
--    repiten cada N días (limpieza de tanques, extintores…) y cada vez que
--    se hicieron.
--  - espacios_comunes / reservas_espacios: salón, parrillero… y sus
--    reservas. Se cancelan, no se borran.
--  - liquidaciones_egreso: la liquidación cuando un socio se va. Se anula,
--    no se borra.
-- No destructiva.

CREATE TABLE IF NOT EXISTS conceptos_cuota (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  monto REAL NOT NULL CHECK (monto >= 0),
  fondo_id INTEGER REFERENCES fondos(id),
  orden INTEGER NOT NULL DEFAULT 0,
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);

-- El cargo mensual de un concepto (para no confundirlo con la cuota social).
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS concepto_cuota_id INTEGER REFERENCES conceptos_cuota(id);

CREATE TABLE IF NOT EXISTS mantenimiento_preventivo (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  frecuencia_dias INTEGER NOT NULL CHECK (frecuencia_dias > 0),
  ultima_vez TEXT,
  proxima_fecha TEXT NOT NULL,
  comision_id INTEGER REFERENCES comisiones(id),
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE IF NOT EXISTS mantenimiento_registros (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  preventivo_id INTEGER NOT NULL REFERENCES mantenimiento_preventivo(id),
  fecha TEXT NOT NULL,
  notas TEXT,
  costo REAL,
  hecho_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE IF NOT EXISTS espacios_comunes (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  capacidad INTEGER,
  requiere_aprobacion SMALLINT NOT NULL DEFAULT 0,
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE IF NOT EXISTS reservas_espacios (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  espacio_id INTEGER NOT NULL REFERENCES espacios_comunes(id),
  fecha TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  motivo TEXT,
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('pendiente', 'confirmada', 'rechazada', 'cancelada')),
  decidido_por_id INTEGER REFERENCES users(id),
  cancelado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_reservas_espacio_fecha ON reservas_espacios (espacio_id, fecha);

CREATE TABLE IF NOT EXISTS liquidaciones_egreso (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  fecha TEXT NOT NULL,
  aportes REAL NOT NULL DEFAULT 0,
  porcentaje_reintegro REAL NOT NULL DEFAULT 100 CHECK (porcentaje_reintegro >= 0 AND porcentaje_reintegro <= 100),
  deuda REAL NOT NULL DEFAULT 0,
  otros_descuentos REAL NOT NULL DEFAULT 0,
  detalle_descuentos TEXT,
  monto_final REAL NOT NULL,
  forma_devolucion TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'aprobada', 'pagada', 'anulada')),
  notas TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  aprobado_por_id INTEGER REFERENCES users(id),
  aprobado_en TEXT,
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_socio ON liquidaciones_egreso (socio_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['conceptos_cuota', 'mantenimiento_preventivo', 'mantenimiento_registros', 'espacios_comunes', 'reservas_espacios', 'liquidaciones_egreso'] LOOP
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
