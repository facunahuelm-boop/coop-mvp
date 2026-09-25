-- Fase 5 (Multicooperativa/arquitectura SaaS(19) + Administrador de
-- plataforma(20) + Planes y módulos(21) + Soporte(22)) — Sub-fase 5.4:
-- Soporte (sección 22, última de esta fase).
--
-- El texto original de la sección 22 está irrecuperable (mismo problema que
-- el resto de la Fase 5). Auditoría previa confirmó que no existía NINGÚN
-- mecanismo de soporte/tickets/contacto — lo más parecido era "Reclamos",
-- pero es 100% para problemas físicos/edilicios de la propia cooperativa,
-- no para consultas o errores del software. Alcance confirmado con el
-- usuario: sistema de tickets tenant→plataforma (cualquier usuario de una
-- cooperativa reporta un problema/consulta; el admin de plataforma los ve
-- TODOS en /plataforma y responde).
--
-- Dos tablas: `tickets_soporte` (el ticket en sí) y `ticket_soporte_mensajes`
-- (el hilo de mensajes de ese ticket — el mensaje inicial es la primera fila
-- de este hilo, no un campo aparte en `tickets_soporte`, para no duplicar el
-- concepto de "mensaje" entre el alta y las respuestas).
--
-- `ticket_soporte_mensajes.autor_user_id` es NULLABLE a propósito: cuando lo
-- escribe el admin de plataforma (`responderTicketPlataformaAction`, en
-- actions/plataforma.ts), esa persona NO es parte de la cooperativa dueña
-- del ticket — un FK a `users(id)` de otra cooperativa rompería la premisa
-- implícita del resto del sistema de que una fila y su autor pertenecen a la
-- misma cooperativa. Se guarda en cambio `autor_nombre_plataforma` (texto
-- plano, capturado en el momento) y `autor_es_platform_admin = true` — mismo
-- criterio de fondo que ya usa crearCooperativaAction (Sub-fase 5.2) para
-- cruzar el límite de RLS desde el lado de la plataforma: una conexión propia
-- con `app.current_org_id` fijado a la cooperativa DEL TICKET, nunca a la del
-- admin de plataforma que ejecuta la acción.
CREATE TABLE IF NOT EXISTS tickets_soporte (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  creado_por_id INTEGER NOT NULL REFERENCES users(id),
  asunto TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'consulta', -- consulta | error | otro
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | en_proceso | resuelto
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_soporte_mensajes (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets_soporte(id),
  autor_user_id INTEGER REFERENCES users(id), -- null cuando lo escribe el admin de plataforma
  autor_es_platform_admin BOOLEAN NOT NULL DEFAULT false,
  autor_nombre_plataforma TEXT, -- solo cuando autor_es_platform_admin = true
  texto TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_soporte_org ON tickets_soporte (organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_soporte_creador ON tickets_soporte (creado_por_id);
CREATE INDEX IF NOT EXISTS idx_ticket_soporte_mensajes_ticket ON ticket_soporte_mensajes (ticket_id);

-- Row-Level Security, mismo criterio que todas las migraciones anteriores.
-- El admin de plataforma NUNCA lee/escribe estas tablas con el pool normal
-- de la app bajo su propio contexto de sesión (eso solo vería la cooperativa
-- a la que él mismo pertenece) — usa la misma conexión elevada (bypass RLS)
-- que ya usan las migraciones y el conteo de usuarios de /plataforma para
-- leer TODOS los tickets, y una conexión puntual con `app.current_org_id`
-- fijado a la cooperativa del ticket para responder/cambiar estado — igual
-- que crearCooperativaAction.
DO $$
DECLARE
  tabla TEXT;
  tablas TEXT[] := ARRAY['tickets_soporte', 'ticket_soporte_mensajes'];
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

GRANT SELECT, INSERT, UPDATE, DELETE ON tickets_soporte, ticket_soporte_mensajes TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
