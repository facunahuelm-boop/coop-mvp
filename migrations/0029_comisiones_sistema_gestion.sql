-- Transformación de Comisiones en un sistema de gestión/comunicación/
-- coordinación entre comisiones (pedido explícito del usuario, 19/09).
-- Ver ARQUITECTURA_COMISIONES.md en la raíz del repo para el diseño
-- completo y por qué cada tabla es nueva vs. extensión de una existente.
--
-- Se crea de una sola vez todo el esquema de las 12 fases (aunque el
-- código se construye e implementa fase por fase) para no obligar al
-- usuario a correr una migración manual distinta en cada fase.
--
-- Nada de esto reemplaza tablas existentes: comisiones/comision_miembros/
-- tareas/reuniones/documentos/gastos_comision/solicitudes_compra/
-- decisiones_compra/alertas siguen funcionando exactamente igual;
-- esto sólo agrega columnas nullable y tablas nuevas.

-- 1) Comisiones dinámicas (Fase 2): tipo, objetivo y vigencia.
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'permanente'; -- permanente | temporal
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS objetivo TEXT;
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS fecha_inicio TEXT;
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS fecha_fin TEXT;
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS comision_padre_id INTEGER REFERENCES comisiones(id); -- subcomisiones (punto 6 del pedido)
-- comision_miembros.rol_en_comision ya es TEXT libre sin CHECK: se suma
-- 'suplente' como valor válido a nivel de código, sin cambio de esquema.

-- 2) Tareas extendidas (Fase 4): checklist, dependencia, etiquetas,
-- vínculo opcional a una solicitud (se crea más abajo).
CREATE TABLE IF NOT EXISTS solicitudes_comision (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  numero TEXT, -- asignado post-insert: 'SOL-2026-0001', ver actions/solicitudes.ts
  tipo TEXT NOT NULL DEFAULT 'otro', -- informacion|aprobacion|compra|presupuesto|tarea|documento|consulta|informe|derivacion|incidente|urgente|otro
  titulo TEXT NOT NULL,
  descripcion TEXT,
  comision_origen_id INTEGER NOT NULL REFERENCES comisiones(id),
  comision_destino_id INTEGER NOT NULL REFERENCES comisiones(id),
  creado_por_id INTEGER NOT NULL REFERENCES users(id),
  responsable_id INTEGER REFERENCES users(id),
  prioridad TEXT NOT NULL DEFAULT 'normal', -- baja|normal|alta|urgente
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente|en_revision|en_proceso|esperando_informacion|aprobada|rechazada|resuelta|cancelada|vencida
  fecha_limite TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tareas ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb; -- [{texto, hecho}]
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS depende_de_id INTEGER REFERENCES tareas(id);
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS etiquetas TEXT; -- CSV, mismo patrón que documentos.etiquetas
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS solicitud_id INTEGER REFERENCES solicitudes_comision(id);

CREATE TABLE IF NOT EXISTS tarea_colaboradores (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  UNIQUE(tarea_id, user_id)
);

-- 3) Solicitudes entre comisiones (Fase 3): comentarios + historial dedicado.
CREATE TABLE IF NOT EXISTS solicitud_comentarios (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_comision(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES users(id),
  cuerpo TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solicitud_eventos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_comision(id) ON DELETE CASCADE,
  evento TEXT NOT NULL, -- creada|recibida|en_revision|informacion_solicitada|informacion_adjuntada|aprobada|rechazada|derivada|resuelta|cancelada|comentario
  de_comision_id INTEGER REFERENCES comisiones(id),
  a_comision_id INTEGER REFERENCES comisiones(id),
  usuario_id INTEGER REFERENCES users(id),
  detalle TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) Decisiones y votaciones (Fase 6). Distintas de decisiones_compra
-- (que sigue siendo la decisión de proveedor dentro de Compras).
CREATE TABLE IF NOT EXISTS decisiones_comision (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  numero TEXT, -- 'DEC-2026-0001', asignado post-insert
  comision_id INTEGER NOT NULL REFERENCES comisiones(id),
  reunion_id INTEGER REFERENCES reuniones(id),
  solicitud_id INTEGER REFERENCES solicitudes_comision(id),
  tema TEXT NOT NULL,
  propuesta TEXT,
  resultado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente|aprobada|rechazada
  decidido_por_id INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votaciones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  decision_id INTEGER REFERENCES decisiones_comision(id),
  comision_id INTEGER REFERENCES comisiones(id),
  pregunta TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'encuesta', -- encuesta|votacion|decision_formal
  opciones JSONB NOT NULL DEFAULT '[]'::jsonb,
  fecha_cierre TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta', -- abierta|cerrada
  creado_por_id INTEGER NOT NULL REFERENCES users(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voto_respuestas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  votacion_id INTEGER NOT NULL REFERENCES votaciones(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  opcion TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(votacion_id, user_id)
);

-- 5) Reuniones: agenda estructurada + participantes por usuario (Fase 5).
-- reunion_asistencias (por núcleo) sigue intacta para asamblea/consejo.
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS modalidad TEXT NOT NULL DEFAULT 'presencial'; -- presencial|virtual|hibrida

CREATE TABLE IF NOT EXISTS reunion_agenda_items (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  reunion_id INTEGER NOT NULL REFERENCES reuniones(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL DEFAULT 0,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  responsable_id INTEGER REFERENCES users(id),
  resultado TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reunion_invitados (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  reunion_id INTEGER NOT NULL REFERENCES reuniones(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  confirmado BOOLEAN NOT NULL DEFAULT false,
  presente BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(reunion_id, user_id)
);

-- 6) Comunicaciones estructuradas (Fase 7) — no es chat libre: siempre
-- tiene asunto y puede referenciar una solicitud/tarea/decisión.
CREATE TABLE IF NOT EXISTS comunicaciones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tipo TEXT NOT NULL DEFAULT 'entre_comision', -- privada|entre_comision|general|consejo_directivo|administrativa|urgente
  comision_id INTEGER REFERENCES comisiones(id),
  autor_id INTEGER NOT NULL REFERENCES users(id),
  destinatario_id INTEGER REFERENCES users(id), -- sólo para tipo='privada'
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  solicitud_id INTEGER REFERENCES solicitudes_comision(id),
  tarea_id INTEGER REFERENCES tareas(id),
  decision_id INTEGER REFERENCES decisiones_comision(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comunicacion_lecturas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  comunicacion_id INTEGER NOT NULL REFERENCES comunicaciones(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  leido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(comunicacion_id, user_id)
);

-- 7) Documentos con contexto (Fase 8): mismo patrón ya usado para
-- solicitud_compra_id (FK nullable dedicada por caso de uso) + versionado.
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS comision_id INTEGER REFERENCES comisiones(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS solicitud_comision_id INTEGER REFERENCES solicitudes_comision(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tarea_id INTEGER REFERENCES tareas(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS reunion_id INTEGER REFERENCES reuniones(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS decision_id INTEGER REFERENCES decisiones_comision(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS comunicacion_id INTEGER REFERENCES comunicaciones(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS reemplaza_a_id INTEGER REFERENCES documentos(id);

-- 8) Notificaciones por usuario (Fase 10) — bandeja de eventos puntuales,
-- distinta y complementaria de "alertas" (motor de reglas recalculado,
-- que sigue funcionando exactamente igual y no se toca).
CREATE TABLE IF NOT EXISTS notificaciones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  tipo TEXT NOT NULL, -- solicitud_recibida|tarea_asignada|mencion|aprobacion_pedida|solicitud_cambio_estado|vencimiento_proximo|tarea_vencida|reunion_creada|reunion_modificada|votacion_abierta|decision_publicada|documento_relevante
  titulo TEXT NOT NULL,
  cuerpo TEXT,
  ref_tabla TEXT,
  ref_id INTEGER,
  leida BOOLEAN NOT NULL DEFAULT false,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para las consultas de listado/paginación (Mi trabajo, Requiere
-- mi atención, Centro de actividad) que van a filtrar por estas columnas.
CREATE INDEX IF NOT EXISTS idx_solicitudes_comision_org ON solicitudes_comision (organization_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_comision_destino ON solicitudes_comision (comision_destino_id, estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_comision_origen ON solicitudes_comision (comision_origen_id, estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_comision_responsable ON solicitudes_comision (responsable_id, estado);
CREATE INDEX IF NOT EXISTS idx_solicitud_comentarios_solicitud ON solicitud_comentarios (solicitud_id);
CREATE INDEX IF NOT EXISTS idx_solicitud_eventos_solicitud ON solicitud_eventos (solicitud_id);
CREATE INDEX IF NOT EXISTS idx_decisiones_comision_comision ON decisiones_comision (comision_id);
CREATE INDEX IF NOT EXISTS idx_votaciones_comision ON votaciones (comision_id);
CREATE INDEX IF NOT EXISTS idx_voto_respuestas_votacion ON voto_respuestas (votacion_id);
CREATE INDEX IF NOT EXISTS idx_reunion_agenda_items_reunion ON reunion_agenda_items (reunion_id);
CREATE INDEX IF NOT EXISTS idx_reunion_invitados_reunion ON reunion_invitados (reunion_id);
CREATE INDEX IF NOT EXISTS idx_reunion_invitados_user ON reunion_invitados (user_id);
CREATE INDEX IF NOT EXISTS idx_comunicaciones_comision ON comunicaciones (comision_id);
CREATE INDEX IF NOT EXISTS idx_comunicaciones_destinatario ON comunicaciones (destinatario_id);
CREATE INDEX IF NOT EXISTS idx_tarea_colaboradores_tarea ON tarea_colaboradores (tarea_id);
CREATE INDEX IF NOT EXISTS idx_tarea_colaboradores_user ON tarea_colaboradores (user_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_user ON notificaciones (user_id, leida);
CREATE INDEX IF NOT EXISTS idx_documentos_comision ON documentos (comision_id);
CREATE INDEX IF NOT EXISTS idx_documentos_solicitud_comision ON documentos (solicitud_comision_id);
CREATE INDEX IF NOT EXISTS idx_documentos_tarea ON documentos (tarea_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_padre ON comisiones (comision_padre_id);

-- Row-Level Security, mismo criterio que todas las migraciones anteriores.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY[
    'solicitudes_comision', 'solicitud_comentarios', 'solicitud_eventos',
    'decisiones_comision', 'votaciones', 'voto_respuestas',
    'reunion_agenda_items', 'reunion_invitados',
    'comunicaciones', 'comunicacion_lecturas',
    'tarea_colaboradores', 'notificaciones'
  ];
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

GRANT SELECT, INSERT, UPDATE, DELETE ON
  solicitudes_comision, solicitud_comentarios, solicitud_eventos,
  decisiones_comision, votaciones, voto_respuestas,
  reunion_agenda_items, reunion_invitados,
  comunicaciones, comunicacion_lecturas,
  tarea_colaboradores, notificaciones
TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

INSERT INTO schema_migrations (filename) VALUES ('0029_comisiones_sistema_gestion.sql') ON CONFLICT (filename) DO NOTHING;
