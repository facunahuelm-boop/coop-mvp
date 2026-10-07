-- 0058 — Fase 2D "Asambleas formales, Consejo y mandatos".
--
--  - asamblea_padron: padrón de la asamblea (foto al convocar). Cada fila es
--    quien vota: el socio titular (o cada adulto del núcleo, si el reglamento
--    lo pide), si está habilitado y la causa visible si no, asistencia y a
--    quién representa con un poder.
--  - asamblea_votaciones / asamblea_votos: votación por punto (a favor, en
--    contra, abstención), con conteo o nominal.
--  - reuniones: datos de la asamblea formal (padrón calculado, quórum
--    confirmado por la mesa, convocatoria enviada).
--  - actas: borrador → aprobada (las de antes quedan como aprobadas).
--  - consejo_directivo_cargos: órgano (Consejo, Comisión Fiscal, Comisión
--    Electoral), fin previsto del mandato y aviso de vencimiento.
-- No destructiva. El sistema ayuda a contar: la validez la decide la mesa
-- según el estatuto.

CREATE TABLE IF NOT EXISTS asamblea_padron (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  reunion_id INTEGER NOT NULL REFERENCES reuniones(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  integrante_id INTEGER REFERENCES socio_integrantes(id),
  nombre TEXT NOT NULL,
  habilitado SMALLINT NOT NULL DEFAULT 1,
  causa TEXT,
  presente SMALLINT NOT NULL DEFAULT 0,
  llegada_en TEXT,
  representado_por_id INTEGER REFERENCES asamblea_padron(id),
  registrado_por_id INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asamblea_padron ON asamblea_padron (reunion_id, socio_id, COALESCE(integrante_id, 0));

CREATE TABLE IF NOT EXISTS asamblea_votaciones (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  reunion_id INTEGER NOT NULL REFERENCES reuniones(id),
  agenda_item_id INTEGER REFERENCES reunion_agenda_items(id),
  titulo TEXT NOT NULL,
  mayoria TEXT NOT NULL DEFAULT 'simple' CHECK (mayoria IN ('simple', 'absoluta', 'dos_tercios')),
  nominal SMALLINT NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada', 'anulada')),
  a_favor INTEGER NOT NULL DEFAULT 0,
  en_contra INTEGER NOT NULL DEFAULT 0,
  abstenciones INTEGER NOT NULL DEFAULT 0,
  votantes INTEGER,
  resultado TEXT CHECK (resultado IN ('aprobada', 'rechazada', 'empate')),
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text),
  cerrada_en TEXT,
  motivo_anulacion TEXT
);

CREATE TABLE IF NOT EXISTS asamblea_votos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  votacion_id INTEGER NOT NULL REFERENCES asamblea_votaciones(id),
  padron_id INTEGER NOT NULL REFERENCES asamblea_padron(id),
  voto TEXT NOT NULL CHECK (voto IN ('a_favor', 'en_contra', 'abstencion')),
  registrado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asamblea_voto ON asamblea_votos (votacion_id, padron_id);

ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS padron_calculado_en TEXT;
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS convocatoria_enviada_en TEXT;
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS quorum_confirmado TEXT;
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS quorum_confirmado_en TEXT;
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS quorum_confirmado_por_id INTEGER REFERENCES users(id);
ALTER TABLE reuniones ADD COLUMN IF NOT EXISTS quorum_detalle TEXT;

ALTER TABLE actas ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'aprobada';
ALTER TABLE actas ADD COLUMN IF NOT EXISTS texto TEXT;
ALTER TABLE actas ADD COLUMN IF NOT EXISTS aprobada_en TEXT;
ALTER TABLE actas ADD COLUMN IF NOT EXISTS aprobada_por_id INTEGER REFERENCES users(id);

ALTER TABLE consejo_directivo_cargos ADD COLUMN IF NOT EXISTS organo TEXT NOT NULL DEFAULT 'consejo';
ALTER TABLE consejo_directivo_cargos ADD COLUMN IF NOT EXISTS fecha_fin_prevista TEXT;
ALTER TABLE consejo_directivo_cargos ADD COLUMN IF NOT EXISTS aviso_vencimiento_en TEXT;
ALTER TABLE consejo_directivo_cargos ADD COLUMN IF NOT EXISTS permisos_revisados_en TEXT;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asamblea_padron', 'asamblea_votaciones', 'asamblea_votos'] LOOP
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
    REVOKE DELETE ON consejo_directivo_cargos FROM app_user;
  END IF;
END $$;
