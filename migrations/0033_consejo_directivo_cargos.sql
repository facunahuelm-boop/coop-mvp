-- Sub-fase 1.4 ("Consejo Directivo — vista propia", 22/09): igual que pasaba
-- con Asambleas antes de la Sub-fase 1.3, una reunión de Consejo Directivo
-- ya es una fila de `reuniones` con tipo='consejo_directivo' (agenda,
-- asistencia, acta con folio propio — migración 0031). Lo único que le
-- falta de verdad es un registro de qué cargo específico (Presidente,
-- Secretario, Tesorero, Vocal) ocupa cada integrante: hoy `users.rol =
-- 'consejo_directivo'` es un rol plano, sin distinguir cargos, aunque los
-- actos legales de la cooperativa (firmas, representación institucional)
-- requieren identificar el cargo puntual, no solo "alguien con ese rol".
--
-- A propósito esto es puramente documental/informativo: NO crea ningún
-- permiso nuevo en el sistema. `users.rol` sigue siendo la única fuente de
-- autorización (canRead/canEdit/canApprove) — esta tabla no se consulta en
-- ningún lado del código de permisos, confirmado, para que quede
-- exactamente como se lo confirmó el usuario.
CREATE TABLE IF NOT EXISTS consejo_directivo_cargos (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  cargo TEXT NOT NULL, -- presidente | secretario | tesorero | vocal
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT, -- null = mandato vigente
  creado_por_id INTEGER REFERENCES users(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consejo_directivo_cargos_org ON consejo_directivo_cargos (organization_id);
CREATE INDEX IF NOT EXISTS idx_consejo_directivo_cargos_user ON consejo_directivo_cargos (user_id);

-- Presidente/Secretario/Tesorero son cargos unipersonales: no puede haber
-- dos titulares vigentes del mismo cargo al mismo tiempo en la misma
-- cooperativa. Vocal se deja afuera a propósito porque un Consejo suele
-- tener varios vocales simultáneos. Salvaguarda ante una carrera entre dos
-- asignaciones simultáneas (mismo criterio que idx_actas_folio_unico de la
-- migración 0031): en vez de guardar en silencio un estado contradictorio,
-- lo rechaza con un error.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consejo_directivo_cargo_unico_vigente
  ON consejo_directivo_cargos (organization_id, cargo)
  WHERE fecha_fin IS NULL AND cargo IN ('presidente', 'secretario', 'tesorero');

-- Row-Level Security, mismo criterio que todas las migraciones anteriores.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE consejo_directivo_cargos ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE consejo_directivo_cargos FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON consejo_directivo_cargos';
  EXECUTE $sql$
    CREATE POLICY tenant_isolation ON consejo_directivo_cargos
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::int)
  $sql$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON consejo_directivo_cargos TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
