-- 0052 — Fase 1B "Horas con un solo número".
--
-- Hasta ahora las horas de ayuda mutua vivían en tres lugares que no se
-- hablaban: lo planificado (asignaciones_horas, migración 0050), el módulo
-- viejo de jornadas (jornadas_trabajo + asistencias) y un contador suelto
-- (nucleos_familiares.horas_acumuladas). Desde esta migración hay un único
-- recorrido: PLANIFICACIÓN → ASISTENCIA → SALDO DEL NÚCLEO.
--
--  - asistencias_horas: qué pasó realmente en cada turno planificado
--    (vino, llegó tarde, se fue antes, faltó con o sin aviso) y los minutos
--    reales. También registra a un núcleo que vino sin turno.
--  - avisos_ausencia: el socio avisa "no puedo ir" (con motivo y, si quiere,
--    un certificado); el coordinador lo aprueba o lo rechaza.
--  - licencias_horas: períodos en que un núcleo no debe horas (enfermedad,
--    maternidad, etc.), aprobados por la comisión.
--  - cierres_semana_horas + saldos_horas_semana: al terminar la semana se
--    "cierra" y se guarda el saldo de cada núcleo (foto inmutable para la
--    libreta). Reabrir una semana queda registrado con motivo.
--
-- Lo viejo NO se migra fila por fila para no contar dos veces: las horas del
-- sistema anterior siguen en nucleos_familiares.horas_acumuladas y la
-- libreta las muestra aparte como "horas del registro anterior".
--
-- No destructiva. Ninguna tabla nueva tiene DELETE para la app.

CREATE TABLE IF NOT EXISTS asistencias_horas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  asignacion_id INTEGER REFERENCES asignaciones_horas(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  comision_id INTEGER REFERENCES comisiones(id),
  fecha TEXT NOT NULL,
  semana TEXT NOT NULL,
  hora_inicio TEXT,
  hora_fin TEXT,
  estado TEXT NOT NULL, -- presente | tarde | retiro_anticipado | ausente_justificada | ausente_injustificada
  minutos_planificados INTEGER NOT NULL DEFAULT 0,
  minutos_reales INTEGER NOT NULL DEFAULT 0,
  observaciones TEXT,
  origen TEXT NOT NULL DEFAULT 'coordinador', -- coordinador | aviso | sin_turno
  confirmado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  actualizado_en TEXT NOT NULL DEFAULT (now()::text),
  anulado_en TEXT,
  anulado_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asistencia_por_turno
  ON asistencias_horas (asignacion_id) WHERE asignacion_id IS NOT NULL AND anulado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_asistencias_horas_semana ON asistencias_horas (organization_id, semana);
CREATE INDEX IF NOT EXISTS idx_asistencias_horas_nucleo ON asistencias_horas (nucleo_id, fecha);

CREATE TABLE IF NOT EXISTS avisos_ausencia (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  asignacion_id INTEGER NOT NULL REFERENCES asignaciones_horas(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  fecha TEXT NOT NULL,
  motivo TEXT NOT NULL,
  adjunto_url TEXT,
  avisado_por_id INTEGER REFERENCES users(id),
  avisado_en TEXT NOT NULL DEFAULT (now()::text),
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aprobado | rechazado | retirado
  revisado_por_id INTEGER REFERENCES users(id),
  revisado_en TEXT,
  respuesta TEXT
);
CREATE INDEX IF NOT EXISTS idx_avisos_ausencia_estado ON avisos_ausencia (organization_id, estado, fecha);

CREATE TABLE IF NOT EXISTS licencias_horas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  motivo TEXT NOT NULL,
  registrada_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  anulada_en TEXT,
  anulada_por_id INTEGER REFERENCES users(id),
  motivo_anulacion TEXT
);
CREATE INDEX IF NOT EXISTS idx_licencias_horas_nucleo ON licencias_horas (nucleo_id, desde, hasta);

CREATE TABLE IF NOT EXISTS cierres_semana_horas (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  semana TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'cerrada', -- cerrada | reabierta
  cerrado_en TEXT NOT NULL DEFAULT (now()::text),
  cerrado_por_id INTEGER REFERENCES users(id), -- NULL = cierre automático
  reabierto_en TEXT,
  reabierto_por_id INTEGER REFERENCES users(id),
  motivo_reapertura TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_semana ON cierres_semana_horas (organization_id, semana);

CREATE TABLE IF NOT EXISTS saldos_horas_semana (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  semana TEXT NOT NULL,
  objetivo_min INTEGER NOT NULL DEFAULT 0,
  planificado_min INTEGER NOT NULL DEFAULT 0,
  real_min INTEGER NOT NULL DEFAULT 0,
  justificado_min INTEGER NOT NULL DEFAULT 0,
  injustificado_min INTEGER NOT NULL DEFAULT 0,
  licencia_min INTEGER NOT NULL DEFAULT 0,
  saldo_min INTEGER NOT NULL DEFAULT 0,
  calculado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saldo_nucleo_semana ON saldos_horas_semana (organization_id, nucleo_id, semana);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asistencias_horas', 'avisos_ausencia', 'licencias_horas', 'cierres_semana_horas', 'saldos_horas_semana'] LOOP
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
