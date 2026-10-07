-- 0061 — Fase 2G "Compras: regla de montos, documentación de proveedores y convenios impagos".
--
--  - proveedor_documentos: certificados (BPS, DGI), seguro del BSE, habilitaciones, con
--    fecha de vencimiento. COOVA avisa al elegir un proveedor con algo vencido y 30 días
--    antes de que venza. No se borran: se dan de baja (activo = 0).
--  - decisiones_compra.excepcion_regla: cuando una compra grande se aprueba con menos
--    presupuestos de los que pide el reglamento, queda escrito por qué (A14).
--  - decisiones_compra.doc_vencida_confirmada: se eligió sabiendo que el proveedor tenía
--    documentación vencida.
-- No destructiva.

CREATE TABLE IF NOT EXISTS proveedor_documentos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  tipo TEXT NOT NULL DEFAULT 'otro' CHECK (tipo IN ('bps', 'dgi', 'bse', 'habilitacion', 'otro')),
  descripcion TEXT,
  fecha_vencimiento TEXT,
  documento_id INTEGER REFERENCES documentos(id),
  activo SMALLINT NOT NULL DEFAULT 1,
  aviso_vencimiento_en TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_proveedor_documentos ON proveedor_documentos (proveedor_id);

ALTER TABLE decisiones_compra ADD COLUMN IF NOT EXISTS excepcion_regla TEXT;
ALTER TABLE decisiones_compra ADD COLUMN IF NOT EXISTS doc_vencida_confirmada SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE proveedor_documentos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE proveedor_documentos FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON proveedor_documentos;
  CREATE POLICY tenant_isolation ON proveedor_documentos
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON proveedor_documentos TO app_user;
    REVOKE DELETE ON proveedor_documentos FROM app_user;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
