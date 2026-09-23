-- Fase 3 ("Reglas de la cooperativa, Estatuto/Reglamentos como
-- configuración, Motor de reglas evento-condición-acción") — Sub-fase 3.3:
-- Motor de reglas evento-condición-acción (sección 14, última de la Fase 3).
--
-- El texto original de la sección 14 está irrecuperable (mismo problema que
-- las secciones 13/15). Alcance confirmado con el usuario, deliberadamente
-- acotado: los 12 tipos de evento que HOY YA disparan una notificación
-- (`solicitud_recibida`, `tarea_asignada`, `reunion_creada`,
-- `votacion_abierta`, `decision_publicada`, `comunicacion_nueva`,
-- `mencion`, `compra_aprobada`, `compra_entregada`, `compra_rechazada`,
-- `gasto_pagado`, `solicitud_cambio_estado` — ver src/lib/notificaciones.ts
-- y los 8 archivos de src/lib/actions/ que los disparan) solo llevan
-- título/cuerpo como texto libre, no datos estructurados (monto, prioridad,
-- etc.). Por eso NO se construye un lenguaje de condiciones sobre datos que
-- no existen: el propio tipo de evento ES la condición ("siempre que pase
-- X, hacé Y"). Las acciones son un catálogo CERRADO de 2 acciones seguras
-- que reusan código ya existente (crearNotificacionesParaUsuarios,
-- crearAlerta) — nunca una acción que apruebe, vote, publique, cierre o
-- cambie estado por sí sola.
CREATE TABLE IF NOT EXISTS reglas_automaticas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  evento TEXT NOT NULL, -- uno de los 12 tipos de notificación existentes (ver EVENTOS_DISPONIBLES en reglasAutomaticas.ts)
  accion_tipo TEXT NOT NULL, -- notificar_rol | crear_alerta
  accion_datos JSONB NOT NULL, -- notificar_rol: {rol, mensaje?} | crear_alerta: {rol, severidad, titulo?}
  activa BOOLEAN NOT NULL DEFAULT true,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reglas_automaticas_org ON reglas_automaticas (organization_id);
-- Para el hot path (buscar reglas activas de un evento cada vez que ese
-- evento ocurre), filtrar directo por evento+activa.
CREATE INDEX IF NOT EXISTS idx_reglas_automaticas_evento ON reglas_automaticas (evento, activa);

-- Row-Level Security, mismo criterio que todas las migraciones anteriores.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE reglas_automaticas ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE reglas_automaticas FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON reglas_automaticas';
  EXECUTE $sql$
    CREATE POLICY tenant_isolation ON reglas_automaticas
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
  $sql$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON reglas_automaticas TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
