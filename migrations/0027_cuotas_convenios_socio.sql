-- Rediseño profundo de Finanzas (pedido explícito del usuario, 16/09):
-- cuotas de socios con vencimiento, convenios de pago y comprobante por
-- pago. La cooperativa ya tenía un libro de "cuenta corriente por socio"
-- (movimientos_cuenta_socio, migración 0007: cargo/pago, sin fecha de
-- vencimiento ni convenio) — esta migración lo EXTIENDE en vez de crear un
-- sistema paralelo, para no terminar con dos fuentes de verdad del saldo de
-- un socio.
--
-- fecha_vencimiento (nullable): sólo tiene sentido en un cargo tipo "cuota"
-- (para poder calcular "vencida" = vencimiento pasado y todavía no cubierta
-- por pagos, vía FIFO calculado en el código, igual que ya se calcula el
-- saldo — no se guarda un estado "pendiente/vencida/pagada" aparte para no
-- desincronizarse).
-- comprobante_url (nullable): mismo patrón ya usado en gastos_comision
-- (Supabase Storage vía src/lib/upload.ts) — un socio o quien registra un
-- pago puede adjuntar el comprobante.
-- convenio_id (nullable): vincula un cargo generado por un convenio de pago
-- con el convenio que lo generó, para poder mostrar "esta cuota es parte
-- del convenio X" — no obliga a nada: un cargo sin convenio (la inmensa
-- mayoría, cuota mensual normal) sigue funcionando exactamente igual.

CREATE TABLE IF NOT EXISTS convenios_pago (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  motivo TEXT NOT NULL,
  monto_total NUMERIC NOT NULL,
  cantidad_cuotas INTEGER NOT NULL,
  monto_cuota NUMERIC NOT NULL,
  dia_vencimiento INTEGER NOT NULL DEFAULT 10, -- día del mes en que vence cada cuota del convenio (1-28)
  fecha_inicio TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | cumplido | incumplido | cancelado
  notas TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS fecha_vencimiento TEXT;
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS comprobante_url TEXT;
ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS convenio_id INTEGER REFERENCES convenios_pago(id);

CREATE INDEX IF NOT EXISTS idx_convenios_pago_org ON convenios_pago (organization_id);
CREATE INDEX IF NOT EXISTS idx_convenios_pago_socio ON convenios_pago (socio_id);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_convenio ON movimientos_cuenta_socio (convenio_id);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta_socio_vencimiento ON movimientos_cuenta_socio (fecha_vencimiento);

-- Row-Level Security, mismo criterio que las migraciones anteriores.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['convenios_pago'];
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
GRANT SELECT, INSERT, UPDATE, DELETE ON convenios_pago TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0027_cuotas_convenios_socio.sql') ON CONFLICT (filename) DO NOTHING;
