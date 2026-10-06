-- 0051 — Fase 1A "Base segura": en COOVA nada se borra (+ preferencia "Letra grande").
--
-- Hasta ahora había cuatro lugares donde un dato de negocio se borraba de
-- verdad (DELETE): convenios de pago (y sus cuotas futuras al cancelarlos),
-- solicitudes de compra, proveedores sin uso y documentos. Desde esta
-- migración:
--
--  1) Convenios: se ANULAN (estado 'anulado', con fecha, quién y motivo). Sus
--     cuotas se anulan también (movimientos_cuenta_socio.estado = 'anulado',
--     columna que ya existe desde la sub-fase 4.4) — quedan en el historial
--     pero no cuentan como deuda.
--
--  2) Solicitudes de compra, proveedores y documentos: "Eliminar" pasa a ser
--     una ELIMINACIÓN LÓGICA (papelera): la fila queda en la base con
--     eliminado_en / eliminado_por_id / motivo_eliminacion. La política de
--     aislamiento (RLS) la oculta de todas las consultas normales de la app,
--     así no hace falta tocar las ~100 consultas que leen esas tablas. Solo
--     una transacción que active explícitamente
--     set_config('app.incluir_eliminados', '1', true) puede verla (lo usa la
--     propia acción de eliminar y, a futuro, una papelera para restaurar).
--     Postgres exige que la fila modificada siga siendo visible para el
--     UPDATE que la marca, por eso el escape es una variable LOCAL a la
--     transacción y no una política aparte.
--
--  3) La app (app_user) pierde el permiso DELETE sobre las tablas de dinero
--     y de negocio: aunque alguien escribiera un DELETE por error en el
--     código, la base lo rechaza.
--
-- No destructiva: solo agrega columnas nullable, recrea políticas con la
-- misma regla de aislamiento por cooperativa más el filtro de eliminados, y
-- revoca permisos.

-- ---------- 1) Convenios: anulación ----------
ALTER TABLE convenios_pago ADD COLUMN IF NOT EXISTS anulado_en TEXT;
ALTER TABLE convenios_pago ADD COLUMN IF NOT EXISTS anulado_por_id INTEGER REFERENCES users(id);
ALTER TABLE convenios_pago ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

-- ---------- 2) Papelera para compras, proveedores y documentos ----------
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS eliminado_en TEXT;
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS eliminado_por_id INTEGER REFERENCES users(id);
ALTER TABLE solicitudes_compra ADD COLUMN IF NOT EXISTS motivo_eliminacion TEXT;

ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS eliminado_en TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS eliminado_por_id INTEGER REFERENCES users(id);
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS motivo_eliminacion TEXT;

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS eliminado_en TEXT;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS eliminado_por_id INTEGER REFERENCES users(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS motivo_eliminacion TEXT;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['solicitudes_compra', 'proveedores', 'documentos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (
           organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int
           AND (eliminado_en IS NULL OR current_setting(''app.incluir_eliminados'', true) = ''1'')
         )
         WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::int)',
      t
    );
  END LOOP;
END $$;

-- ---------- 3) La app no puede borrar datos de negocio ----------
DO $$
DECLARE
  t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    FOREACH t IN ARRAY ARRAY[
      'movimientos_cuenta_socio', 'convenios_pago', 'movimientos_financieros',
      'gastos_comision', 'solicitudes_compra', 'presupuestos_proveedor',
      'decisiones_compra', 'proveedores', 'documentos', 'socios',
      'nucleos_familiares', 'asignaciones_horas', 'actas', 'auditoria'
    ] LOOP
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
        EXECUTE format('REVOKE DELETE ON %I FROM app_user', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ---------- 4) Accesibilidad: "Letra grande" por usuario ----------
-- Preferencia personal (se guarda por usuario, así se mantiene al entrar
-- desde otro celular o computadora). La app agranda todo ~12% y aumenta el
-- contraste del texto secundario.
ALTER TABLE users ADD COLUMN IF NOT EXISTS letra_grande BOOLEAN NOT NULL DEFAULT false;
