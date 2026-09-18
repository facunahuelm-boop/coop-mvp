-- Rediseño visual global (18/09, pedido explícito): la nueva paleta del
-- sistema es verde (ver src/app/globals.css). El color de marca de cada
-- cooperativa (organizations.color_primario) es multi-tenant y
-- personalizable desde Configuración → Marca — pintar la barra lateral/
-- superior de TODAS las cooperativas de verde a la fuerza rompería esa
-- funcionalidad para cualquiera que ya haya elegido su propio color.
--
-- Esta migración sólo despierta en verde a las cooperativas que NUNCA
-- tocaron ese campo (siguen exactamente en el valor por defecto histórico
-- '#123240', ver migrations/0001_organizations.sql) — cualquier cooperativa
-- que ya personalizó su color (aunque por coincidencia hubiera elegido un
-- tono parecido) no se toca, porque no hay forma de distinguir "nunca lo
-- cambió" de "lo cambió a propósito a algo parecido" salvo por este mismo
-- valor exacto, y el criterio del proyecto es no tocar nada que ya esté
-- configurado a propósito.
UPDATE organizations SET color_primario = '#16a34a' WHERE color_primario = '#123240';

-- Alta futura de cooperativas (multi-tenant): el default pasa a ser el
-- nuevo verde en vez del navy viejo.
ALTER TABLE organizations ALTER COLUMN color_primario SET DEFAULT '#16a34a';

INSERT INTO schema_migrations (filename) VALUES ('0028_color_marca_default_verde.sql') ON CONFLICT (filename) DO NOTHING;
