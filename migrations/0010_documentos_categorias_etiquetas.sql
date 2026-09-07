-- Fase 07 del Plan Maestro — Documentos y PDF: falta la parte de
-- "carpetas/etiquetas" (el storage en Supabase y el generador de PDF con
-- pdfkit ya estaban resueltos por migraciones anteriores, ver 0005 y
-- src/lib/pdf.ts). Hoy la categoría de un documento es una lista fija de 13
-- valores en código (CATEGORIAS en documentos/page.tsx) — ninguna
-- cooperativa puede agregar la suya propia (ej: "Estatuto", "RRHH"), tal
-- como ya se señaló en la auditoría (§05/§06 del Plan Maestro).
--
-- Esta migración agrega dos cosas, mismo patrón ya usado en comisiones
-- (Fase 06): categorías propias por cooperativa, y etiquetas libres por
-- documento para poder filtrar transversalmente a la categoría (ej: todos
-- los documentos etiquetados "obra-etapa-2", sin importar si están en
-- Técnicos, Facturas o Contratos).

CREATE TABLE IF NOT EXISTS documento_categorias (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  creado_por_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, nombre)
);

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS etiquetas TEXT;

ALTER TABLE documento_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_categorias FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documento_categorias;
CREATE POLICY tenant_isolation ON documento_categorias
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);

INSERT INTO schema_migrations (filename) VALUES ('0010_documentos_categorias_etiquetas.sql') ON CONFLICT (filename) DO NOTHING;
