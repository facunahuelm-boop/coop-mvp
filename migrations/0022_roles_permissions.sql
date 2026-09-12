-- Fase 4 del "Prompt Maestro" (arquitectura de usuarios/roles/permisos),
-- diseño ya especificado en REQUIREMENTS.md sección 5.4: una capa de
-- permisos granulares (`recurso.accion`, ej. "documentos.edit") construida
-- SOBRE la matriz de roles existente (src/lib/roles.ts), no como su
-- reemplazo — así ningún chequeo de permisos existente (canRead/canEdit/
-- canApprove ni los 6 helpers finos como puedeGestionarReclamos) cambia de
-- comportamiento con esta migración.
--
-- Por qué tres tablas nuevas en vez de tocar `users.rol`: `users.rol` sigue
-- siendo un string simple (no se pasa a multi-rol todavía, a propósito — ver
-- REQUIREMENTS.md 5.4 punto 4). Estas tablas son el catálogo/base para que,
-- a futuro, una cooperativa pueda tener roles o permisos adicionales sin
-- tocar código; hoy simplemente reflejan 1:1 lo que la MATRIX ya hace.
--
-- Alcance deliberadamente NO incluido en esta migración (documentado, no
-- olvidado): no hay tabla `user_permissions` para permisos extra por
-- usuario individual (eso es el punto 4 de la sección 5.4, "a futuro") — se
-- agrega cuando haya una razón concreta para usarla, no de antemano.
--
-- Sin organization_id / RLS: al igual que `organizations`, son catálogos
-- globales del sistema (qué son los roles, qué permisos existen), no datos
-- de una cooperativa puntual.

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE, -- coincide 1:1 con los strings de ROLES en src/lib/roles.ts
  etiqueta TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  recurso TEXT NOT NULL, -- un Module de roles.ts (ej. "documentos")
  accion TEXT NOT NULL, -- read | edit | approve | config (mismos niveles que Access en roles.ts)
  nombre TEXT NOT NULL UNIQUE, -- "recurso.accion", ej. "documentos.edit"
  UNIQUE (recurso, accion)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Seed generado a partir de la MATRIX real de src/lib/roles.ts (no
-- transcripto a mano fila por fila): mismo criterio de jerarquía que ya usan
-- canRead/canEdit/canApprove (config incluye approve, que incluye edit, que
-- incluye read). Ver scripts/generar-seed-permisos.mjs para la lógica que
-- produjo estos INSERT, por si la MATRIX cambia y hay que regenerarlos.

-- roles: seed 1:1 con ROLES (src/lib/roles.ts)
INSERT INTO roles (nombre, etiqueta) VALUES
  ('socio', 'Socio/a'),
  ('comision_obra', 'Comisión de Obra'),
  ('comision_trabajo', 'Comisión de Trabajo'),
  ('comision_compras', 'Comisión de Compras'),
  ('comision_seguridad', 'Comisión de Seguridad'),
  ('administracion', 'Administración'),
  ('tesoreria', 'Tesorería'),
  ('consejo_directivo', 'Consejo Directivo'),
  ('fiscal', 'Comisión Fiscal'),
  ('tecnico', 'IAT / Dirección técnica'),
  ('admin', 'Administrador del sistema')
ON CONFLICT (nombre) DO NOTHING;

-- permissions: catálogo recurso.accion — solo los permisos que la MATRIX
-- (roles.ts) realmente otorga a algún rol hoy (ej. "auditoria" nunca llega a
-- edit/approve/config, así que esos no se inventan acá).
INSERT INTO permissions (recurso, accion, nombre) VALUES
  ('auditoria', 'read', 'auditoria.read'),
  ('comisiones', 'approve', 'comisiones.approve'),
  ('comisiones', 'config', 'comisiones.config'),
  ('comisiones', 'edit', 'comisiones.edit'),
  ('comisiones', 'read', 'comisiones.read'),
  ('compras', 'approve', 'compras.approve'),
  ('compras', 'config', 'compras.config'),
  ('compras', 'edit', 'compras.edit'),
  ('compras', 'read', 'compras.read'),
  ('documentos', 'approve', 'documentos.approve'),
  ('documentos', 'config', 'documentos.config'),
  ('documentos', 'edit', 'documentos.edit'),
  ('documentos', 'read', 'documentos.read'),
  ('finanzas', 'approve', 'finanzas.approve'),
  ('finanzas', 'config', 'finanzas.config'),
  ('finanzas', 'edit', 'finanzas.edit'),
  ('finanzas', 'read', 'finanzas.read'),
  ('obra', 'approve', 'obra.approve'),
  ('obra', 'config', 'obra.config'),
  ('obra', 'edit', 'obra.edit'),
  ('obra', 'read', 'obra.read'),
  ('reclamos', 'approve', 'reclamos.approve'),
  ('reclamos', 'config', 'reclamos.config'),
  ('reclamos', 'edit', 'reclamos.edit'),
  ('reclamos', 'read', 'reclamos.read'),
  ('seguridad', 'approve', 'seguridad.approve'),
  ('seguridad', 'config', 'seguridad.config'),
  ('seguridad', 'edit', 'seguridad.edit'),
  ('seguridad', 'read', 'seguridad.read'),
  ('socios', 'approve', 'socios.approve'),
  ('socios', 'config', 'socios.config'),
  ('socios', 'edit', 'socios.edit'),
  ('socios', 'read', 'socios.read'),
  ('trabajo', 'approve', 'trabajo.approve'),
  ('trabajo', 'config', 'trabajo.config'),
  ('trabajo', 'edit', 'trabajo.edit'),
  ('trabajo', 'read', 'trabajo.read')
ON CONFLICT (nombre) DO NOTHING;

-- role_permissions: derivado 1:1 de la MATRIX existente (roles.ts) —
-- jerarquía config > approve > edit > read, igual que canRead/canEdit/canApprove.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('socio', 'obra.read'),
  ('socio', 'trabajo.read'),
  ('socio', 'seguridad.read'),
  ('socio', 'finanzas.read'),
  ('socio', 'documentos.read'),
  ('socio', 'comisiones.read'),
  ('socio', 'socios.read'),
  ('socio', 'reclamos.read'),
  ('socio', 'reclamos.edit'),
  ('comision_obra', 'obra.read'),
  ('comision_obra', 'obra.edit'),
  ('comision_obra', 'trabajo.read'),
  ('comision_obra', 'compras.read'),
  ('comision_obra', 'compras.edit'),
  ('comision_obra', 'seguridad.read'),
  ('comision_obra', 'documentos.read'),
  ('comision_obra', 'comisiones.read'),
  ('comision_obra', 'comisiones.edit'),
  ('comision_obra', 'socios.read'),
  ('comision_obra', 'reclamos.read'),
  ('comision_trabajo', 'obra.read'),
  ('comision_trabajo', 'trabajo.read'),
  ('comision_trabajo', 'trabajo.edit'),
  ('comision_trabajo', 'compras.read'),
  ('comision_trabajo', 'compras.edit'),
  ('comision_trabajo', 'seguridad.read'),
  ('comision_trabajo', 'documentos.read'),
  ('comision_trabajo', 'comisiones.read'),
  ('comision_trabajo', 'comisiones.edit'),
  ('comision_trabajo', 'socios.read'),
  ('comision_trabajo', 'reclamos.read'),
  ('comision_compras', 'obra.read'),
  ('comision_compras', 'trabajo.read'),
  ('comision_compras', 'compras.read'),
  ('comision_compras', 'compras.edit'),
  ('comision_compras', 'seguridad.read'),
  ('comision_compras', 'finanzas.read'),
  ('comision_compras', 'documentos.read'),
  ('comision_compras', 'comisiones.read'),
  ('comision_compras', 'comisiones.edit'),
  ('comision_compras', 'socios.read'),
  ('comision_compras', 'reclamos.read'),
  ('comision_seguridad', 'obra.read'),
  ('comision_seguridad', 'trabajo.read'),
  ('comision_seguridad', 'compras.read'),
  ('comision_seguridad', 'compras.edit'),
  ('comision_seguridad', 'seguridad.read'),
  ('comision_seguridad', 'seguridad.edit'),
  ('comision_seguridad', 'documentos.read'),
  ('comision_seguridad', 'comisiones.read'),
  ('comision_seguridad', 'comisiones.edit'),
  ('comision_seguridad', 'socios.read'),
  ('comision_seguridad', 'reclamos.read'),
  ('comision_seguridad', 'reclamos.edit'),
  ('administracion', 'obra.read'),
  ('administracion', 'trabajo.read'),
  ('administracion', 'compras.read'),
  ('administracion', 'seguridad.read'),
  ('administracion', 'finanzas.read'),
  ('administracion', 'finanzas.edit'),
  ('administracion', 'documentos.read'),
  ('administracion', 'documentos.edit'),
  ('administracion', 'comisiones.read'),
  ('administracion', 'comisiones.edit'),
  ('administracion', 'socios.read'),
  ('administracion', 'socios.edit'),
  ('administracion', 'reclamos.read'),
  ('administracion', 'reclamos.edit'),
  ('tesoreria', 'obra.read'),
  ('tesoreria', 'trabajo.read'),
  ('tesoreria', 'compras.read'),
  ('tesoreria', 'compras.edit'),
  ('tesoreria', 'compras.approve'),
  ('tesoreria', 'seguridad.read'),
  ('tesoreria', 'finanzas.read'),
  ('tesoreria', 'finanzas.edit'),
  ('tesoreria', 'finanzas.approve'),
  ('tesoreria', 'documentos.read'),
  ('tesoreria', 'auditoria.read'),
  ('tesoreria', 'comisiones.read'),
  ('tesoreria', 'socios.read'),
  ('tesoreria', 'reclamos.read'),
  ('consejo_directivo', 'obra.read'),
  ('consejo_directivo', 'obra.edit'),
  ('consejo_directivo', 'obra.approve'),
  ('consejo_directivo', 'trabajo.read'),
  ('consejo_directivo', 'trabajo.edit'),
  ('consejo_directivo', 'trabajo.approve'),
  ('consejo_directivo', 'compras.read'),
  ('consejo_directivo', 'compras.edit'),
  ('consejo_directivo', 'compras.approve'),
  ('consejo_directivo', 'seguridad.read'),
  ('consejo_directivo', 'seguridad.edit'),
  ('consejo_directivo', 'seguridad.approve'),
  ('consejo_directivo', 'finanzas.read'),
  ('consejo_directivo', 'finanzas.edit'),
  ('consejo_directivo', 'finanzas.approve'),
  ('consejo_directivo', 'documentos.read'),
  ('consejo_directivo', 'documentos.edit'),
  ('consejo_directivo', 'auditoria.read'),
  ('consejo_directivo', 'comisiones.read'),
  ('consejo_directivo', 'comisiones.edit'),
  ('consejo_directivo', 'comisiones.approve'),
  ('consejo_directivo', 'socios.read'),
  ('consejo_directivo', 'socios.edit'),
  ('consejo_directivo', 'socios.approve'),
  ('consejo_directivo', 'reclamos.read'),
  ('consejo_directivo', 'reclamos.edit'),
  ('consejo_directivo', 'reclamos.approve'),
  ('fiscal', 'obra.read'),
  ('fiscal', 'trabajo.read'),
  ('fiscal', 'compras.read'),
  ('fiscal', 'seguridad.read'),
  ('fiscal', 'finanzas.read'),
  ('fiscal', 'documentos.read'),
  ('fiscal', 'auditoria.read'),
  ('fiscal', 'comisiones.read'),
  ('fiscal', 'socios.read'),
  ('fiscal', 'reclamos.read'),
  ('tecnico', 'obra.read'),
  ('tecnico', 'obra.edit'),
  ('tecnico', 'trabajo.read'),
  ('tecnico', 'compras.read'),
  ('tecnico', 'seguridad.read'),
  ('tecnico', 'seguridad.edit'),
  ('tecnico', 'documentos.read'),
  ('tecnico', 'comisiones.read'),
  ('tecnico', 'socios.read'),
  ('tecnico', 'reclamos.read'),
  ('tecnico', 'reclamos.edit'),
  ('admin', 'obra.read'),
  ('admin', 'obra.edit'),
  ('admin', 'obra.approve'),
  ('admin', 'obra.config'),
  ('admin', 'trabajo.read'),
  ('admin', 'trabajo.edit'),
  ('admin', 'trabajo.approve'),
  ('admin', 'trabajo.config'),
  ('admin', 'compras.read'),
  ('admin', 'compras.edit'),
  ('admin', 'compras.approve'),
  ('admin', 'compras.config'),
  ('admin', 'seguridad.read'),
  ('admin', 'seguridad.edit'),
  ('admin', 'seguridad.approve'),
  ('admin', 'seguridad.config'),
  ('admin', 'finanzas.read'),
  ('admin', 'finanzas.edit'),
  ('admin', 'finanzas.approve'),
  ('admin', 'finanzas.config'),
  ('admin', 'documentos.read'),
  ('admin', 'documentos.edit'),
  ('admin', 'documentos.approve'),
  ('admin', 'documentos.config'),
  ('admin', 'auditoria.read'),
  ('admin', 'comisiones.read'),
  ('admin', 'comisiones.edit'),
  ('admin', 'comisiones.approve'),
  ('admin', 'comisiones.config'),
  ('admin', 'socios.read'),
  ('admin', 'socios.edit'),
  ('admin', 'socios.approve'),
  ('admin', 'socios.config'),
  ('admin', 'reclamos.read'),
  ('admin', 'reclamos.edit'),
  ('admin', 'reclamos.approve'),
  ('admin', 'reclamos.config')
) AS v(rol_nombre, permiso_nombre)
JOIN roles r ON r.nombre = v.rol_nombre
JOIN permissions p ON p.nombre = v.permiso_nombre
ON CONFLICT (role_id, permission_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON roles, permissions, role_permissions TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0022_roles_permissions.sql') ON CONFLICT (filename) DO NOTHING;
