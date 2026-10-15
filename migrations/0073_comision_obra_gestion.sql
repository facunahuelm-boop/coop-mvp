-- 0073 — Gestión de la Comisión de Obra según el Reglamento de Obra y Ayuda
-- Mutua de UFAMA (Art. 5, 8, 10, 11 y 18). No destructiva: solo agrega una
-- columna y tablas nuevas; nada se borra (la app no tiene DELETE).
--
--  - comision_miembros.representa: a quién representa cada integrante de la
--    Comisión de Obra (Compras, Administración, Tesorería, Dirección de Obra,
--    Capataz o socio/a votado/a en asamblea) — Art. 10.
--  - plan_trabajo_obra: planes de trabajo mensuales y semanales (Art. 11b).
--  - turnos_extendidos_obra: horario extendido (lun-vie 17 a 22) y sábados
--    (7 a 12) con la tarea planificada y la persona encargada de turno
--    (Art. 18 d, f, g).
--  - controles_calidad_obra: evaluación de actividades y control de calidad
--    y de uso de materiales (Art. 11d).
--  - personal_contratado_obra: personal contratado; no puede ser socio/a
--    (Art. 5c). Lo aprueba el Consejo Directivo.
--  - licitaciones_obra / ofertas_licitacion: pedidos de precios con un mínimo
--    de tres ofertas (Art. 5b, 11c).
--  - guardias_obra: guardias (17 a 22) y serenatas (22 a 07) por núcleo
--    (Art. 8o, 18h, 34). No computan como horas de ayuda mutua.

ALTER TABLE comision_miembros ADD COLUMN IF NOT EXISTS representa TEXT;

CREATE TABLE IF NOT EXISTS plan_trabajo_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('semanal', 'mensual')),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  tarea TEXT NOT NULL,
  responsable_id INTEGER REFERENCES users(id),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'hecha')),
  anulado_en TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_plan_trabajo_obra_org ON plan_trabajo_obra (organization_id, desde);

CREATE TABLE IF NOT EXISTS turnos_extendidos_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('extendido', 'sabado')),
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT NOT NULL,
  tarea TEXT NOT NULL,
  supervision TEXT,
  encargado_id INTEGER NOT NULL REFERENCES users(id),
  estado TEXT NOT NULL DEFAULT 'planificado' CHECK (estado IN ('planificado', 'realizado', 'cancelado')),
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_turnos_extendidos_org ON turnos_extendidos_obra (organization_id, fecha);

CREATE TABLE IF NOT EXISTS controles_calidad_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  fecha TEXT NOT NULL,
  actividad TEXT NOT NULL,
  rubro_id INTEGER REFERENCES obra_rubros(id),
  resultado TEXT NOT NULL CHECK (resultado IN ('conforme', 'observado', 'rechazado')),
  materiales_ok SMALLINT NOT NULL DEFAULT 1,
  observaciones TEXT,
  evaluado_por_id INTEGER REFERENCES users(id),
  anulado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_controles_calidad_org ON controles_calidad_obra (organization_id, fecha);

CREATE TABLE IF NOT EXISTS personal_contratado_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  nombre TEXT NOT NULL,
  documento TEXT,
  oficio TEXT NOT NULL,
  desde TEXT,
  hasta TEXT,
  estado TEXT NOT NULL DEFAULT 'propuesto' CHECK (estado IN ('propuesto', 'aprobado', 'rechazado', 'finalizado')),
  observaciones TEXT,
  propuesto_por_id INTEGER REFERENCES users(id),
  resuelto_por_id INTEGER REFERENCES users(id),
  resuelto_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_personal_contratado_org ON personal_contratado_obra (organization_id);

CREATE TABLE IF NOT EXISTS licitaciones_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'adjudicada', 'desierta')),
  oferta_elegida_id INTEGER,
  justificacion TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  cerrada_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_licitaciones_obra_org ON licitaciones_obra (organization_id);

CREATE TABLE IF NOT EXISTS ofertas_licitacion (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  licitacion_id INTEGER NOT NULL REFERENCES licitaciones_obra(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  proveedor_nombre TEXT NOT NULL,
  monto REAL NOT NULL CHECK (monto >= 0),
  plazo TEXT,
  observaciones TEXT,
  anulada_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_ofertas_licitacion ON ofertas_licitacion (licitacion_id);

CREATE TABLE IF NOT EXISTS guardias_obra (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('guardia', 'serenata')),
  nucleo_id INTEGER NOT NULL REFERENCES nucleos_familiares(id),
  estado TEXT NOT NULL DEFAULT 'asignada' CHECK (estado IN ('asignada', 'cumplida', 'falta_justificada', 'falta_injustificada')),
  observaciones TEXT,
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardias_obra ON guardias_obra (organization_id, fecha, tipo, nucleo_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['plan_trabajo_obra', 'turnos_extendidos_obra', 'controles_calidad_obra', 'personal_contratado_obra', 'licitaciones_obra', 'ofertas_licitacion', 'guardias_obra'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
      EXECUTE format('REVOKE DELETE ON %I FROM app_user', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END $$;
