-- 0066 — Fase 3D "Avance físico contra financiero y desembolsos del préstamo".
--
--  - obra_rubros: los rubros de la obra con su incidencia (% del total) y su
--    monto en el presupuesto de obra. Se desactivan, no se borran.
--  - obra_avances_rubro: cada medición del avance de un rubro (% acumulado).
--    Se anulan, no se borran.
--  - obra_plan_mensual: el avance planificado (acumulado) para cada mes.
--  - prestamo_desembolsos: los desembolsos del préstamo, con el avance que
--    exigen, cuándo se pidieron y cuándo se cobraron. Se anulan, no se borran.
-- No destructiva.

CREATE TABLE IF NOT EXISTS obra_rubros (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  peso_pct REAL NOT NULL DEFAULT 0 CHECK (peso_pct >= 0 AND peso_pct <= 100),
  monto REAL NOT NULL DEFAULT 0 CHECK (monto >= 0),
  activo SMALLINT NOT NULL DEFAULT 1,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_obra_rubros_org ON obra_rubros (organization_id);

CREATE TABLE IF NOT EXISTS obra_avances_rubro (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  rubro_id INTEGER NOT NULL REFERENCES obra_rubros(id),
  fecha TEXT NOT NULL,
  avance_pct REAL NOT NULL CHECK (avance_pct >= 0 AND avance_pct <= 100),
  observaciones TEXT,
  registrado_por_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_obra_avances_rubro ON obra_avances_rubro (rubro_id, fecha);

CREATE TABLE IF NOT EXISTS obra_plan_mensual (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  mes TEXT NOT NULL,
  avance_pct REAL NOT NULL CHECK (avance_pct >= 0 AND avance_pct <= 100),
  actualizado_por_id INTEGER REFERENCES users(id),
  actualizado_en TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (organization_id, mes)
);

CREATE TABLE IF NOT EXISTS prestamo_desembolsos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  numero INTEGER NOT NULL,
  descripcion TEXT,
  monto_previsto REAL NOT NULL CHECK (monto_previsto >= 0),
  fecha_prevista TEXT,
  avance_requerido_pct REAL CHECK (avance_requerido_pct >= 0 AND avance_requerido_pct <= 100),
  estado TEXT NOT NULL DEFAULT 'previsto' CHECK (estado IN ('previsto', 'solicitado', 'cobrado', 'anulado')),
  fecha_solicitud TEXT,
  fecha_cobro TEXT,
  monto_cobrado REAL,
  compromiso_id INTEGER REFERENCES compromisos_futuros(id),
  observaciones TEXT,
  registrado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  actualizado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_prestamo_desembolsos_org ON prestamo_desembolsos (organization_id, numero);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['obra_rubros', 'obra_avances_rubro', 'obra_plan_mensual', 'prestamo_desembolsos'] LOOP
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
