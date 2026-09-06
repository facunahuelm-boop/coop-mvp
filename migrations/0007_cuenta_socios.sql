-- Fase 10 del Plan Maestro — Cuenta corriente por socio.
--
-- Finanzas ya cubre ingresos/egresos generales de la cooperativa y
-- presupuesto vs. real, pero no contesta la pregunta más básica que un socio
-- puede tener ("¿cuánto debo?") sin llamar a tesorería — algo que los tres
-- sistemas de referencia (CoopNet, CODA, AGIV) ya resuelven y que la
-- auditoría marcó como prioridad real, no un capricho.
--
-- Esta migración agrega un libro de movimientos por socio (cargos y pagos),
-- independiente de movimientos_financieros (que es la caja general de la
-- cooperativa, no el estado de cuenta de cada socio). El saldo de un socio
-- se calcula sumando sus cargos y restando sus pagos — no se guarda un
-- campo "saldo" aparte para no tener dos fuentes de verdad que puedan
-- desincronizarse.

CREATE TABLE IF NOT EXISTS movimientos_cuenta_socio (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  tipo TEXT NOT NULL, -- cargo (aumenta la deuda, ej: cuota mensual) | pago (la reduce)
  concepto TEXT NOT NULL,
  monto NUMERIC NOT NULL, -- siempre positivo; el signo lo da "tipo"
  fecha TEXT NOT NULL,
  notas TEXT,
  registrado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_org ON movimientos_cuenta_socio (organization_id);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_socio ON movimientos_cuenta_socio (socio_id);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_fecha ON movimientos_cuenta_socio (fecha);

-- Row-Level Security, mismo criterio que las migraciones anteriores.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['movimientos_cuenta_socio'];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tabla);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int) WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)',
      tabla
    );
  END LOOP;
END $$;

-- Ver nota en migrations/0004_comisiones_reuniones.sql: los permisos de
-- app_user se otorgan tabla por tabla, hace falta repetirlo para tablas nuevas.
GRANT SELECT, INSERT, UPDATE, DELETE ON movimientos_cuenta_socio TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0007_cuenta_socios.sql') ON CONFLICT (filename) DO NOTHING;
