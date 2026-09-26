-- Rediseño de identidad visual (26/09, pedido explícito): la nueva paleta del
-- sistema es Azul Navy #1E3A5F con Verde petróleo #0F766E como secundario
-- (ver src/app/globals.css). El color de marca de cada cooperativa
-- (organizations.color_primario/color_secundario) es multi-tenant y
-- personalizable desde Configuración → Marca — pintar la barra lateral/
-- superior de TODAS las cooperativas a la fuerza rompería esa
-- funcionalidad para cualquiera que ya haya elegido su propio color.
--
-- Mismo criterio que migrations/0028_color_marca_default_verde.sql: esta
-- migración sólo actualiza a las cooperativas que NUNCA tocaron esos campos
-- (siguen exactamente en el valor por defecto anterior, el verde '#16a34a' /
-- '#15803d' del rediseño 18/09) — cualquier cooperativa que ya personalizó su
-- color (aunque por coincidencia hubiera elegido un tono parecido) no se
-- toca, porque no hay forma de distinguir "nunca lo cambió" de "lo cambió a
-- propósito a algo parecido" salvo por este mismo valor exacto.
UPDATE organizations SET color_primario = '#1e3a5f' WHERE color_primario = '#16a34a';
UPDATE organizations SET color_secundario = '#0f766e' WHERE color_secundario = '#15803d';

-- Alta futura de cooperativas (multi-tenant): el default pasa a ser el
-- nuevo Navy en vez del verde viejo.
ALTER TABLE organizations ALTER COLUMN color_primario SET DEFAULT '#1e3a5f';

INSERT INTO schema_migrations (filename) VALUES ('0046_color_marca_default_navy.sql') ON CONFLICT (filename) DO NOTHING;
