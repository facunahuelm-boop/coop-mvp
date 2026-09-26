-- Rediseño del Calendario, Etapa 4 (26/09, pedido explícito, punto 20:
-- "participantes" además del único responsable que ya existía). Decisiones
-- confirmadas con el usuario antes de esta migración:
--   1) "Mi agenda" cuenta como "mío" únicamente lo que tiene un concepto real
--      de asignación por persona en este sistema hoy: autor, responsable o
--      participante de una actividad de calendario — no eventos de otros
--      módulos (reuniones, obra, etc.), que no tienen ese concepto (las
--      reuniones registran asistencia por núcleo familiar, no por usuario).
--   2) La vista "Agenda propia" se activa con un selector Mes/Agenda en la
--      misma pantalla del calendario, no una URL aparte.
--   3) Los filtros compactos cubren Categoría + Comisión + "Sólo lo mío".
--
-- Diseño elegido para participantes: una tabla de unión nueva
-- (actividad_participantes), NO un ARRAY nativo de Postgres en
-- notas_calendario.participantes — src/lib/db.ts hace JSON.stringify de
-- cualquier valor `object` al armar un INSERT/UPDATE (pensado para columnas
-- JSONB, no ARRAY) y esa función la comparten ~30 acciones más en todo el
-- proyecto; una tabla de unión evita tocarla y sigue el mismo patrón que ya
-- usa este sistema para relaciones de "varios usuarios por fila"
-- (tarea_colaboradores, comision_miembros, reunion_asistencias) — no hay
-- ningún precedente de columna ARRAY en ninguna migración anterior. Esto se
-- dejó pendiente explícitamente en la Etapa 1 (ver CHANGELOG) para
-- resolverlo junto con "Mi agenda", que es donde participantes hace falta.
CREATE TABLE IF NOT EXISTS actividad_participantes (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nota_id INTEGER NOT NULL REFERENCES notas_calendario(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES users(id),
  UNIQUE (nota_id, usuario_id)
);

DO $$
BEGIN
  ALTER TABLE actividad_participantes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE actividad_participantes FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON actividad_participantes;
  CREATE POLICY tenant_isolation ON actividad_participantes
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int);
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON actividad_participantes TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

CREATE INDEX IF NOT EXISTS idx_actividad_participantes_nota ON actividad_participantes (nota_id);
CREATE INDEX IF NOT EXISTS idx_actividad_participantes_usuario ON actividad_participantes (usuario_id);

INSERT INTO schema_migrations (filename) VALUES ('0044_participantes_calendario.sql') ON CONFLICT (filename) DO NOTHING;
