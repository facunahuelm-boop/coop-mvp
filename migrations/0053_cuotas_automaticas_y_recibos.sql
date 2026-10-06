-- 0053 — Fase 1C "Cuotas que se hacen solas".
--
--  - recibos: cada pago genera su recibo numerado (correlativo por
--    cooperativa) con un código de verificación que se imprime como QR. Un
--    recibo nunca se borra: si el pago se corrige o se anula, el recibo se
--    ANULA (con motivo) y, si corresponde, se emite uno nuevo.
--  - ejecuciones_automaticas: registro de lo que hizo el sistema solo
--    (generar las cuotas del mes, cerrar semanas de horas, recargos,
--    recordatorios). Sirve para no repetir una tarea y para que se vea qué
--    pasó y cuándo.
--  - movimientos_cuenta_socio.recargo_de_id: un recargo por atraso apunta a
--    la cuota que lo originó (como máximo un recargo vigente por cuota).
--
-- Las reglas (día de generación, monto, vencimiento, gracia, recargo, avisos)
-- viven en configuracion_reglas, editables en "Reglamento de la cooperativa".
-- Por defecto todo lo automático está APAGADO: cada cooperativa lo prende
-- cuando revisó sus valores. No destructiva.

CREATE TABLE IF NOT EXISTS recibos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  numero INTEGER NOT NULL,
  movimiento_id INTEGER NOT NULL REFERENCES movimientos_cuenta_socio(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  monto NUMERIC(14, 2) NOT NULL,
  fecha TEXT NOT NULL,
  concepto TEXT,
  metodo_pago TEXT,
  codigo_verificacion TEXT NOT NULL,
  emitido_en TEXT NOT NULL DEFAULT (now()::text),
  emitido_por_id INTEGER REFERENCES users(id),
  enviado_en TEXT,
  enviado_a TEXT,
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT,
  reemplazado_por_id INTEGER REFERENCES recibos(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recibo_numero ON recibos (organization_id, numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recibo_codigo ON recibos (codigo_verificacion);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recibo_vigente_por_pago ON recibos (movimiento_id) WHERE anulado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_recibos_socio ON recibos (socio_id);

CREATE TABLE IF NOT EXISTS ejecuciones_automaticas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tipo TEXT NOT NULL,     -- generar_cuotas | recargos | recordatorio_cuota | cerrar_semanas_horas
  periodo TEXT NOT NULL,  -- ej. '2026-10' o el id de la cuota recordada
  ejecutado_en TEXT NOT NULL DEFAULT (now()::text),
  resultado TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ejecucion_automatica ON ejecuciones_automaticas (organization_id, tipo, periodo);

ALTER TABLE movimientos_cuenta_socio ADD COLUMN IF NOT EXISTS recargo_de_id INTEGER REFERENCES movimientos_cuenta_socio(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recargo_por_cuota
  ON movimientos_cuenta_socio (recargo_de_id) WHERE recargo_de_id IS NOT NULL AND COALESCE(estado, 'activo') <> 'anulado';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['recibos', 'ejecuciones_automaticas'] LOOP
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
