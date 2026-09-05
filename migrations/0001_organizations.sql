-- Fase 0 — Fundaciones multi-tenant.
-- Crea la tabla raíz: cada cooperativa es una fila de "organizations".
-- No requiere organization_id (es la tabla raíz de la que cuelgan todas las demás).

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,               -- usado en el subdominio: <slug>.plataforma.uy
  nombre TEXT NOT NULL,
  logo_url TEXT,
  foto_portada_url TEXT,
  color_primario TEXT NOT NULL DEFAULT '#123240',
  color_secundario TEXT,
  etapa TEXT NOT NULL DEFAULT 'obra',      -- pre_obra | obra | habitada
  plan TEXT NOT NULL DEFAULT 'trial',
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (NOW()::text)
);

-- Cooperativa de referencia para desarrollo local (coincide con el
-- DEFAULT_SLUG usado cuando no hay subdominio propio configurado, ver
-- src/proxy.ts). No es obligatoria: cada instalación real da de alta sus
-- propias cooperativas con el asistente de alta, no editando esta migración.
INSERT INTO organizations (slug, nombre, color_primario, etapa)
VALUES ('coova', 'COOVA', '#123240', 'obra')
ON CONFLICT (slug) DO NOTHING;
